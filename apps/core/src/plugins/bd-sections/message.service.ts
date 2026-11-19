import { parseBdMobile } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { type ID, type RequestContext, TransactionalConnection } from '@vendure/core';
import { In, MoreThan } from 'typeorm';
import { BdContactMessage } from './entities';

export interface ContactMessageInput {
    name: string;
    phone: string;
    message?: string | null;
    page?: string | null;
}

/** Why a message wasn't taken: which field to fix, or that too many came in. */
export type ContactMessageError = 'name' | 'phone' | 'tooMany';

/** The most one mobile number, and the whole store, may send in an hour. */
const PER_PHONE_AN_HOUR = 3;
const PER_STORE_AN_HOUR = 200;
const KEPT = 2000;

const clean = (value: unknown, max: number) =>
    String(value ?? '')
        .normalize('NFC')
        // Control characters, except the line break and tab a message may have.
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max);

/**
 * Messages from the contact form element (roadmap phase 61). Anyone may send one, so each is
 * checked and counted: a real Bangladeshi mobile number, a few an hour per number, and a ceiling
 * for the store so a flood can't fill the table.
 */
@Injectable()
export class ContactMessageService {
    constructor(private connection: TransactionalConnection) {}

    async submit(ctx: RequestContext, input: ContactMessageInput): Promise<ContactMessageError | null> {
        const name = clean(input.name, 80).replace(/\s+/g, ' ');
        if (!name) return 'name';
        const phone = parseBdMobile(String(input.phone ?? '').slice(0, 40));
        if (!phone.ok) return 'phone';
        const repo = this.connection.getRepository(ctx, BdContactMessage);
        const since = MoreThan(new Date(Date.now() - 60 * 60 * 1000));
        const [fromPhone, fromAll] = await Promise.all([
            repo.count({ where: { phone: phone.phone.e164, createdAt: since } }),
            repo.count({ where: { createdAt: since } }),
        ]);
        if (fromPhone >= PER_PHONE_AN_HOUR || fromAll >= PER_STORE_AN_HOUR) return 'tooMany';
        const page = clean(input.page, 200);
        await repo.save(
            new BdContactMessage({
                name,
                phone: phone.phone.e164,
                message: clean(input.message, 1000),
                page: page.startsWith('/') ? page : '',
            }),
        );
        // The oldest go once there are very many.
        const extra = await repo.find({
            order: { createdAt: 'DESC' },
            skip: KEPT,
            take: 100,
            select: ['id'],
        });
        if (extra.length) await repo.delete({ id: In(extra.map(row => row.id)) });
        return null;
    }

    async list(
        ctx: RequestContext,
        options: { skip?: number | null; take?: number | null; handled?: boolean | null },
    ) {
        const [items, totalItems] = await this.connection.getRepository(ctx, BdContactMessage).findAndCount({
            where: options.handled == null ? {} : { handled: options.handled },
            order: { createdAt: 'DESC' },
            skip: Math.max(0, options.skip ?? 0),
            take: Math.min(100, Math.max(1, options.take ?? 25)),
        });
        return { items, totalItems };
    }

    waiting(ctx: RequestContext) {
        return this.connection.getRepository(ctx, BdContactMessage).count({ where: { handled: false } });
    }

    async setHandled(ctx: RequestContext, id: ID, handled: boolean): Promise<boolean> {
        const { affected } = await this.connection
            .getRepository(ctx, BdContactMessage)
            .update(id, { handled });
        return !!affected;
    }

    async remove(ctx: RequestContext, id: ID): Promise<boolean> {
        const { affected } = await this.connection.getRepository(ctx, BdContactMessage).delete(id);
        return !!affected;
    }
}
