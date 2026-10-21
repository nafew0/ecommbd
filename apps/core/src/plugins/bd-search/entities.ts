import { type DeepPartial, EntityId, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Unique } from 'typeorm';

/** How often a search found nothing, per term and Dhaka day (roadmap phase 13). Kept 30 days. */
@Entity('bd_search_miss')
@Unique('UQ_bd_search_miss_term_day', ['channelId', 'term', 'day'])
export class BdSearchMiss extends VendureEntity {
    constructor(input?: DeepPartial<BdSearchMiss>) {
        super(input);
    }

    @EntityId()
    channelId: ID;

    /** The query as typed, cleaned (never a phone number or email: see `isPrivateSearchTerm`). */
    @Column({ type: 'varchar', length: 100 })
    term: string;

    /** The Dhaka day, `YYYY-MM-DD`. */
    @Column({ type: 'date' })
    day: string;

    @Column({ type: 'int', default: 1 })
    count: number;
}
