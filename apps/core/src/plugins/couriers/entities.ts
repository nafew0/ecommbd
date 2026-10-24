import type { BookingStatus, Courier, CourierMode, CourierOutcome } from '@ecommbd/shared';
import { type DeepPartial, type ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, Unique } from 'typeorm';

/** One courier answer or status, kept for support (JSON text, personal data removed). */
export interface CourierEvent {
    at: string;
    /** book, webhook, poll, manual, cancel */
    source: string;
    status: string;
    data: string;
}

/**
 * A parcel booked (or being booked) with a courier for an order (phase 19). `activeKey` is the
 * order ID while the booking is live (booking, booked, manual) and null otherwise: unique, so an
 * order can never have two live bookings, however many clicks or retries.
 */
@Entity('bd_courier_booking')
export class BdCourierBooking extends VendureEntity {
    constructor(input?: DeepPartial<BdCourierBooking>) {
        super(input);
    }

    @Index()
    @Column({ type: 'int' })
    orderId: ID;

    @Index({ unique: true })
    @Column({ type: 'varchar', length: 20, nullable: true })
    activeKey: string | null;

    @Column({ type: 'varchar', length: 16 })
    courier: Courier;

    @Column({ type: 'varchar', length: 8 })
    mode: CourierMode;

    @Index()
    @Column({ type: 'varchar', length: 12 })
    status: BookingStatus;

    /** The courier's consignment ID; also how webhooks find the booking. */
    @Index()
    @Column({ type: 'varchar', length: 60, nullable: true })
    consignmentId: string | null;

    @Column({ type: 'varchar', length: 60, nullable: true })
    trackingCode: string | null;

    /** Poisha, whole taka: what the courier collects. */
    @Column({ type: 'int' })
    codAmount: number;

    @Column({ type: 'int', nullable: true })
    weightGrams: number | null;

    /** Poisha, the courier's charge when it told us. */
    @Column({ type: 'int', nullable: true })
    deliveryFee: number | null;

    /** Our reading of the courier's latest status (booked, pickedUp, delivered…). */
    @Index()
    @Column({ type: 'varchar', length: 20, default: 'booked' })
    outcome: CourierOutcome;

    /** The courier's own latest status word, e.g. in_review, Picked, hold. */
    @Column({ type: 'varchar', length: 60, nullable: true })
    courierStatus: string | null;

    /** When the courier says the latest applied status happened (its own time): older updates never move it back. */
    @Column({ type: 'timestamp', precision: 6, nullable: true })
    statusAt: Date | null;

    /** When we applied the latest outcome (the home widget counts by it). */
    @Index()
    @Column({ type: 'timestamp', precision: 6, nullable: true })
    outcomeAt: Date | null;

    /** Why booking failed: a code (UNMAPPED_ADDRESS, COURIER_REFUSED…) and the courier's message. */
    @Column({ type: 'varchar', length: 40, nullable: true })
    errorCode: string | null;

    @Column({ type: 'varchar', length: 500, nullable: true })
    errorMessage: string | null;

    @Column({ type: 'varchar', length: 120, nullable: true })
    bookedBy: string | null;

    /** The polling task's next look (active parcels only). */
    @Index()
    @Column({ type: 'timestamp', precision: 6, nullable: true })
    nextPollAt: Date | null;

    @Column({ type: 'jsonb', default: () => "'[]'" })
    events: CourierEvent[];
}

/** Pathao's cities and zones, fetched from Pathao and refreshed weekly. */
@Entity('bd_courier_location')
@Unique(['courier', 'kind', 'externalId'])
export class BdCourierLocation extends VendureEntity {
    constructor(input?: DeepPartial<BdCourierLocation>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16 })
    courier: Courier;

    /** city, zone or area */
    @Index()
    @Column({ type: 'varchar', length: 8 })
    kind: 'city' | 'zone' | 'area';

    @Column({ type: 'int' })
    externalId: number;

    /** The city of a zone, the zone of an area. */
    @Index()
    @Column({ type: 'int', nullable: true })
    parentId: number | null;

    @Column({ type: 'varchar', length: 120 })
    name: string;
}

/**
 * Our district and thana → the courier's city and zone. Found automatically by name (`auto`) or
 * chosen by staff in the unmapped addresses screen (`manual`); applies to every later order.
 */
@Entity('bd_courier_location_map')
@Unique(['courier', 'districtId', 'thanaId'])
export class BdCourierLocationMap extends VendureEntity {
    constructor(input?: DeepPartial<BdCourierLocationMap>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 16 })
    courier: Courier;

    @Column({ type: 'varchar', length: 20 })
    districtId: string;

    /** A bd-geo thana ID, or `other` (then the map is for the district's "not in the list" addresses). */
    @Column({ type: 'varchar', length: 20 })
    thanaId: string;

    @Column({ type: 'int' })
    cityId: number;

    @Column({ type: 'int' })
    zoneId: number;

    @Column({ type: 'int', nullable: true })
    areaId: number | null;

    @Column({ type: 'varchar', length: 8 })
    source: 'auto' | 'manual';
}
