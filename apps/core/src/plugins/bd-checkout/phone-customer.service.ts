import { isPlaceholderEmail, placeholderEmailFor } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    Customer,
    CustomerEvent,
    EventBus,
    ID,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull, Not } from 'typeorm';
import type { CustomerSource } from './types';

export interface PhoneCustomerInput {
    /** The full name as typed, already cleaned. Used only when a new customer is created. */
    name: string;
    /** E.164 */
    phone: string;
    alternatePhone?: string | null;
    /** A real email the shopper gave, already validated and lowercased. */
    email?: string | null;
    source: CustomerSource;
}

export interface PhoneCustomerResult {
    customer: Customer;
    /**
     * The email the shopper gave when it can't go on this customer (another customer has it, or
     * this customer already has a different one). Stored on the order instead.
     */
    contactEmail: string | null;
}

/** PostgreSQL's unique-violation code. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
    const candidate = error as { code?: string; driverError?: { code?: string } };
    return candidate?.code === UNIQUE_VIOLATION || candidate?.driverError?.code === UNIQUE_VIOLATION;
}

/**
 * Customers keyed by phone number (roadmap phase 03): one customer per phone, found or created at
 * checkout. A found customer is never changed except to fill what it lacks (a real email in place
 * of the placeholder, an alternate phone), so a family sharing a phone keeps the first name.
 */
@Injectable()
export class PhoneCustomerService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private eventBus: EventBus,
    ) {}

    findByPhone(ctx: RequestContext, phone: string): Promise<Customer | null> {
        return this.connection.getRepository(ctx, Customer).findOne({
            where: { customFields: { phone }, deletedAt: IsNull() },
            relations: { user: true, channels: true },
        });
    }

    /**
     * Must run outside a transaction: a new customer is created in its own short transaction, so
     * when two checkouts create the same phone at once, the loser's unique-index error can be
     * caught and the winner's customer used instead.
     */
    async findOrCreate(ctx: RequestContext, input: PhoneCustomerInput): Promise<PhoneCustomerResult> {
        const existing = await this.findByPhone(ctx, input.phone);
        if (existing) {
            return this.useExisting(ctx, existing, input);
        }
        const emailFree = input.email ? !(await this.emailInUse(ctx, input.email)) : false;
        const emailAddress = input.email && emailFree ? input.email : placeholderEmailFor(input.phone);
        try {
            const customer = await this.create(ctx, input, emailAddress);
            return { customer, contactEmail: input.email && !emailFree ? input.email : null };
        } catch (error) {
            const winner = isUniqueViolation(error) ? await this.findByPhone(ctx, input.phone) : null;
            if (!winner) {
                throw error;
            }
            return this.useExisting(ctx, winner, input);
        }
    }

    /** Clears a deleted customer's phone, so the number can start a new customer. */
    async releasePhone(customerId: ID): Promise<void> {
        await this.connection.rawConnection
            .getRepository(Customer)
            .update({ id: customerId, deletedAt: Not(IsNull()) }, { customFields: { phone: null } });
    }

    private async useExisting(
        ctx: RequestContext,
        customer: Customer,
        input: PhoneCustomerInput,
    ): Promise<PhoneCustomerResult> {
        let contactEmail: string | null = null;
        const changes: Partial<Customer> = {};
        if (input.email && input.email !== customer.emailAddress) {
            const canTakeEmail =
                isPlaceholderEmail(customer.emailAddress) &&
                !customer.user &&
                !(await this.emailInUse(ctx, input.email));
            if (canTakeEmail) {
                changes.emailAddress = input.email;
            } else {
                contactEmail = input.email;
            }
        }
        if (input.alternatePhone && !customer.customFields.alternatePhone) {
            changes.customFields = { ...customer.customFields, alternatePhone: input.alternatePhone };
        }
        if (Object.keys(changes).length) {
            Object.assign(customer, changes);
            await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
        }
        if (!customer.channels?.some(channel => channel.id === ctx.channelId)) {
            await this.channelService.assignToCurrentChannel(customer, ctx);
            await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
        }
        return { customer, contactEmail };
    }

    private create(ctx: RequestContext, input: PhoneCustomerInput, emailAddress: string): Promise<Customer> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, Customer);
            const customer = await repository.save(
                new Customer({
                    firstName: input.name,
                    lastName: '',
                    emailAddress,
                    phoneNumber: input.phone,
                    customFields: {
                        phone: input.phone,
                        alternatePhone: input.alternatePhone ?? null,
                        source: input.source,
                    },
                }),
            );
            await this.channelService.assignToCurrentChannel(customer, txCtx);
            const saved = await repository.save(customer);
            await this.eventBus.publish(
                new CustomerEvent(txCtx, saved, 'created', {
                    firstName: input.name,
                    lastName: '',
                    emailAddress,
                }),
            );
            return saved;
        });
    }

    private async emailInUse(ctx: RequestContext, email: string): Promise<boolean> {
        const count = await this.connection
            .getRepository(ctx, Customer)
            .count({ where: { emailAddress: email, deletedAt: IsNull() } });
        return count > 0;
    }
}
