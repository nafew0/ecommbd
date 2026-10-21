import { cleanText, IP_BLOCK_MAX_DAYS, parseBdMobile } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { type ID, type RequestContext, TransactionalConnection } from '@vendure/core';
import { isIP } from 'node:net';
import { Brackets, IsNull } from 'typeorm';
import { BdBlockEntry, type BlockKind } from './entities';
import { staffName } from './staff';

export interface BlockInput {
    kind: BlockKind;
    value: string;
    /** Required for IPs (at most 30 days); optional for phones (permanent without). */
    expiresAt?: Date | string | null;
    note?: string | null;
}

export type BlockErrorCode = 'INVALID_PHONE' | 'INVALID_IP' | 'EXPIRY_REQUIRED' | 'EXPIRY_TOO_LONG' | 'EXPIRY_IN_PAST';

const DAY = 24 * 60 * 60_000;

/** IPv4 as is; IPv6 lowercased, with IPv4-mapped addresses (::ffff:1.2.3.4) as IPv4. */
export function normalizeIp(value: string): string | null {
    const ip = value.trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, '');
    return isIP(ip) ? ip : null;
}

/**
 * The block list (roadmap phase 11): phones (permanent or until a date) and IPs (temporary only:
 * many mobile shoppers share one IP). Unblocking keeps the entry with who did it and why.
 */
@Injectable()
export class BlockListService {
    constructor(private connection: TransactionalConnection) {}

    async block(ctx: RequestContext, input: BlockInput): Promise<BdBlockEntry | { error: BlockErrorCode }> {
        let value: string;
        if (input.kind === 'phone') {
            const phone = parseBdMobile(input.value);
            if (!phone.ok) return { error: 'INVALID_PHONE' };
            value = phone.phone.e164;
        } else {
            const ip = normalizeIp(input.value);
            if (!ip) return { error: 'INVALID_IP' };
            value = ip;
        }
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        if (input.kind === 'ip' && !expiresAt) return { error: 'EXPIRY_REQUIRED' };
        if (expiresAt && expiresAt.getTime() <= Date.now()) return { error: 'EXPIRY_IN_PAST' };
        if (input.kind === 'ip' && expiresAt!.getTime() > Date.now() + IP_BLOCK_MAX_DAYS * DAY) {
            return { error: 'EXPIRY_TOO_LONG' };
        }
        const repository = this.connection.getRepository(ctx, BdBlockEntry);
        // Blocking again replaces the old entry: one active entry per phone or IP.
        await repository.update(
            { kind: input.kind, value, removedAt: IsNull() },
            { removedAt: new Date(), removedBy: await staffName(this.connection, ctx), removedReason: 'replaced' },
        );
        return repository.save(
            new BdBlockEntry({
                kind: input.kind,
                value,
                expiresAt,
                note: cleanText(input.note ?? '', { multiline: true }).slice(0, 500),
                addedBy: await staffName(this.connection, ctx),
                removedAt: null,
            }),
        );
    }

    async unblock(ctx: RequestContext, id: ID, reason: string): Promise<BdBlockEntry | null> {
        const repository = this.connection.getRepository(ctx, BdBlockEntry);
        const entry = await repository.findOne({ where: { id, removedAt: IsNull() } });
        if (!entry) return null;
        entry.removedAt = new Date();
        entry.removedBy = await staffName(this.connection, ctx);
        entry.removedReason = cleanText(reason, { multiline: true }).slice(0, 500);
        return repository.save(entry);
    }

    /** The active entry for a phone or IP, if any. */
    async find(ctx: RequestContext, kind: BlockKind, value: string | null | undefined): Promise<BdBlockEntry | null> {
        const normalized = !value ? null : kind === 'ip' ? normalizeIp(value) : value;
        if (!normalized) return null;
        return this.connection
            .getRepository(ctx, BdBlockEntry)
            .createQueryBuilder('entry')
            .where('entry.kind = :kind AND entry.value = :value AND entry.removedAt IS NULL', {
                kind,
                value: normalized,
            })
            .andWhere(
                new Brackets(where =>
                    where.where('entry.expiresAt IS NULL').orWhere('entry.expiresAt > :now', { now: new Date() }),
                ),
            )
            .getOne();
    }

    /** Active entries, newest first; `search` is part of a phone number or IP. */
    async list(ctx: RequestContext, options: { kind?: BlockKind | null; search?: string | null; skip?: number; take?: number }) {
        const query = this.connection
            .getRepository(ctx, BdBlockEntry)
            .createQueryBuilder('entry')
            .where('entry.removedAt IS NULL')
            .andWhere(
                new Brackets(where =>
                    where.where('entry.expiresAt IS NULL').orWhere('entry.expiresAt > :now', { now: new Date() }),
                ),
            )
            .orderBy('entry.createdAt', 'DESC')
            .skip(options.skip ?? 0)
            .take(Math.min(options.take ?? 50, 100));
        if (options.kind) query.andWhere('entry.kind = :kind', { kind: options.kind });
        const search = options.search?.replace(/[^0-9a-f.:]/gi, '');
        if (search) query.andWhere('entry.value LIKE :search', { search: `%${search}%` });
        const [items, totalItems] = await query.getManyAndCount();
        return { items, totalItems };
    }
}
