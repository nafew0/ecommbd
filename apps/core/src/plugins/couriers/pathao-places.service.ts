import { findDistrict, findThana } from '@ecommbd/bd-geo';
import { matchPlace } from '@ecommbd/shared';
import { Injectable } from '@nestjs/common';
import { Logger, RequestContext, TransactionalConnection } from '@vendure/core';
import { loggerCtx } from './constants';
import { CourierClients } from './courier-clients.service';
import { CourierSettingsService } from './courier-settings.service';
import { pathaoDriver } from './drivers/pathao';
import { BdCourierBooking, BdCourierLocation, BdCourierLocationMap } from './entities';
import { CourierActionError } from './errors';

/**
 * Pathao addresses parcels by its own city and zone IDs (phase 19). We keep a copy of its cities and
 * zones (refreshed weekly or with "Get Pathao's areas now") and a map from our district and thana to
 * them: matched by name, or chosen by staff on the unmapped addresses screen. Areas (Pathao's level
 * below a zone) aren't fetched: Pathao's `recipient_area` is optional and city and zone place a parcel.
 *
 * Sandbox and live have their own IDs, so the copy and the map are for the current mode only: they
 * are cleared when the mode changes (`forget`), and staff get the places again.
 */
@Injectable()
export class PathaoPlacesService {
    constructor(
        private connection: TransactionalConnection,
        private clients: CourierClients,
        private settings: CourierSettingsService,
    ) {}

    /**
     * Our district and thana as Pathao's city and zone: a saved map first; else matched by name and
     * aliases from the copied location list (and saved as `auto`); else null (unmapped).
     */
    async place(ctx: RequestContext, districtId: string, thanaId: string) {
        if (!districtId || !thanaId) return null;
        const maps = this.connection.getRepository(ctx, BdCourierLocationMap);
        const saved = await maps.findOne({ where: { courier: 'pathao', districtId, thanaId } });
        if (saved) return saved;
        const district = findDistrict(districtId);
        const thana = findThana(thanaId);
        if (!district || !thana) return null;
        const locations = this.connection.getRepository(ctx, BdCourierLocation);
        const cities = await locations.find({ where: { courier: 'pathao', kind: 'city' } });
        const city = matchPlace(
            [district.en, ...district.aliases],
            cities.map(c => ({ id: c.externalId, name: c.name })),
        );
        if (!city) return null;
        const zones = await locations.find({ where: { courier: 'pathao', kind: 'zone', parentId: city.id } });
        const zone = matchPlace(
            [thana.en, ...thana.aliases],
            zones.map(z => ({ id: z.externalId, name: z.name })),
        );
        if (!zone) return null;
        return maps.save(
            new BdCourierLocationMap({
                courier: 'pathao',
                districtId,
                thanaId,
                cityId: city.id,
                zoneId: zone.id,
                areaId: null,
                source: 'auto',
            }),
        );
    }

    /** Fetches Pathao's cities and zones (weekly, or "Get Pathao's areas now"). Returns how many of each. */
    async sync(ctx: RequestContext): Promise<{ cities: number; zones: number }> {
        const handle = await this.clients.handle(ctx, 'pathao', await this.settings.mode(ctx, 'pathao'));
        if (!handle) throw new CourierActionError('COURIER_OFF');
        const cities = await pathaoDriver.cities(handle.call);
        const repository = this.connection.getRepository(ctx, BdCourierLocation);
        let zones = 0;
        for (const city of cities) {
            await repository.upsert(
                { courier: 'pathao', kind: 'city', externalId: city.id, parentId: null, name: city.name },
                ['courier', 'kind', 'externalId'],
            );
            for (const zone of await pathaoDriver.zones(handle.call, city.id)) {
                zones++;
                await repository.upsert(
                    {
                        courier: 'pathao',
                        kind: 'zone',
                        externalId: zone.id,
                        parentId: city.id,
                        name: zone.name,
                    },
                    ['courier', 'kind', 'externalId'],
                );
            }
        }
        return { cities: cities.length, zones };
    }

    /**
     * Pathao's mode changed (sandbox ↔ live): the copied places and every map (also staff's) used the
     * other mode's IDs, so they go. A booking already made keeps its own IDs.
     */
    async forget(ctx: RequestContext) {
        const maps = await this.connection
            .getRepository(ctx, BdCourierLocationMap)
            .delete({ courier: 'pathao' });
        const places = await this.connection
            .getRepository(ctx, BdCourierLocation)
            .delete({ courier: 'pathao' });
        Logger.info(
            `Pathao mode changed: cleared ${places.affected ?? 0} places and ${maps.affected ?? 0} address maps`,
            loggerCtx,
        );
    }

    list(ctx: RequestContext, kind: 'city' | 'zone', parentId?: number | null) {
        return this.connection.getRepository(ctx, BdCourierLocation).find({
            where: { courier: 'pathao', kind, ...(parentId ? { parentId } : {}) },
            order: { name: 'ASC' },
        });
    }

    /**
     * Addresses Pathao couldn't place: the latest failed booking of each order still waiting to be
     * booked, by district and thana, with how many orders wait.
     */
    async unmapped(ctx: RequestContext) {
        const rows: Array<{ orderId: number; districtId: string | null; thanaId: string | null }> =
            await this.connection.getRepository(ctx, BdCourierBooking).query(
                // Vendure keeps the shipping address as JSON text.
                `SELECT DISTINCT ON (b."orderId") b."orderId",
                        o."shippingAddress"::jsonb -> 'customFields' ->> 'districtId' AS "districtId",
                        o."shippingAddress"::jsonb -> 'customFields' ->> 'thanaId' AS "thanaId"
                 FROM bd_courier_booking b
                 JOIN "order" o ON o.id = b."orderId"
                 WHERE b."errorCode" = 'UNMAPPED_ADDRESS'
                   AND o.state IN ('Confirmed', 'Packed')
                   AND NOT EXISTS (SELECT 1 FROM bd_courier_booking live WHERE live."activeKey" = b."orderId"::text)
                 ORDER BY b."orderId", b.id DESC`,
            );
        const groups = new Map<string, { districtId: string; thanaId: string; orderIds: number[] }>();
        for (const row of rows) {
            if (!row.districtId || !row.thanaId) continue;
            const mapped = await this.connection
                .getRepository(ctx, BdCourierLocationMap)
                .count({ where: { courier: 'pathao', districtId: row.districtId, thanaId: row.thanaId } });
            if (mapped) continue;
            const key = `${row.districtId}|${row.thanaId}`;
            const group = groups.get(key) ?? {
                districtId: row.districtId,
                thanaId: row.thanaId,
                orderIds: [],
            };
            group.orderIds.push(row.orderId);
            groups.set(key, group);
        }
        return [...groups.values()];
    }

    async setMapping(
        ctx: RequestContext,
        input: {
            districtId: string;
            thanaId: string;
            cityId: number;
            zoneId: number;
            areaId?: number | null;
        },
    ) {
        if (!findDistrict(input.districtId) || (!findThana(input.thanaId) && input.thanaId !== 'other')) {
            throw new CourierActionError('INVALID_INPUT');
        }
        const zone = await this.connection.getRepository(ctx, BdCourierLocation).findOne({
            where: { courier: 'pathao', kind: 'zone', externalId: input.zoneId, parentId: input.cityId },
        });
        if (!zone) throw new CourierActionError('INVALID_INPUT');
        const repository = this.connection.getRepository(ctx, BdCourierLocationMap);
        await repository.upsert(
            {
                courier: 'pathao',
                districtId: input.districtId,
                thanaId: input.thanaId,
                cityId: input.cityId,
                zoneId: input.zoneId,
                areaId: input.areaId ?? null,
                source: 'manual',
            },
            ['courier', 'districtId', 'thanaId'],
        );
        return repository.findOne({
            where: { courier: 'pathao', districtId: input.districtId, thanaId: input.thanaId },
        });
    }
}
