import { banglaToAsciiDigits, cleanText, parseBdPhone } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import {
    Customer,
    ListQueryBuilder,
    type ListQueryOptions,
    type PaginatedList,
    RequestContext,
} from '@vendure/core';
import { Brackets, IsNull } from 'typeorm';

export interface CustomerSearchOptions {
    search?: string | null;
    skip?: number | null;
    take?: number | null;
}

const MAX_TAKE = 100;

/** `%` and `_` typed by staff are matched literally. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, char => `\\${char}`);

/**
 * The admin's customer list (roadmap phase 03): searched by phone the way staff type it. Digits
 * (Bangla digits too) match any part of the phone or alternate phone, so the last few digits are
 * enough; a full number matches exactly; anything else matches the name or a real email.
 */
@Injectable()
export class CustomerSearchService {
    constructor(private listQueryBuilder: ListQueryBuilder) {}

    async search(ctx: RequestContext, options: CustomerSearchOptions = {}): Promise<PaginatedList<Customer>> {
        const qb = this.listQueryBuilder.build(
            Customer,
            {
                skip: options.skip ?? 0,
                take: Math.min(options.take ?? 20, MAX_TAKE),
                sort: { createdAt: 'DESC' } as ListQueryOptions<Customer>['sort'],
            },
            { ctx, channelId: ctx.channelId, where: { deletedAt: IsNull() } },
        );
        const term = cleanText(banglaToAsciiDigits(options.search ?? ''));
        const digits = term.replace(/[\s\-().+]/g, '');
        if (/^\d{3,}$/.test(digits)) {
            const full = parseBdPhone(term);
            const exact = full.ok && full.phone.national.length >= 10;
            qb.andWhere(
                new Brackets(where => {
                    if (exact) {
                        where
                            .where('customer.customFields.phone = :phone', { phone: full.phone.e164 })
                            .orWhere('customer.customFields.alternatePhone = :phone');
                    } else {
                        where
                            .where('customer.customFields.phone LIKE :digits', { digits: `%${digits}%` })
                            .orWhere('customer.customFields.alternatePhone LIKE :digits');
                    }
                }),
            );
        } else if (term) {
            const like = `%${escapeLike(term)}%`;
            qb.andWhere(
                new Brackets(where => {
                    where
                        .where(`(customer.firstName || ' ' || customer.lastName) ILIKE :like`, { like })
                        .orWhere(
                            `customer.emailAddress ILIKE :like AND customer.emailAddress NOT LIKE '%.invalid'`,
                        );
                }),
            );
        }
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
}
