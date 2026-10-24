import { findDistrict, findThana } from '@ecommbd/bd-geo';
import { COURIER_MODES, COURIERS, type CourierMode, courierTrackingUrl, isCourier } from '@ecommbd/shared';
import { Args, Mutation, Query, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ErrorResult,
    type ID,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { updateStoreSettingsPermission } from '../bd-core';
import { bookCourierPermission } from './constants';
import { CourierActionError, type CourierErrorCode, CourierService } from './courier.service';
import { CourierSettingsService } from './courier-settings.service';
import { pathaoDriver } from './drivers/pathao';
import { BdCourierLocation, type BdCourierBooking } from './entities';

export class BdCourierError extends ErrorResult {
    readonly __typename = 'BdCourierError';
    readonly errorCode = 'BD_COURIER_ERROR' as never;
    readonly message: string;
    constructor(
        readonly reason: CourierErrorCode,
        readonly detail?: string,
    ) {
        super();
        this.message = `BD_COURIER.${reason}`;
    }
}

const view = (booking: BdCourierBooking) => ({
    ...booking,
    trackingUrl:
        booking.consignmentId && isCourier(booking.courier) && booking.status === 'booked'
            ? courierTrackingUrl(booking.courier, {
                  consignmentId: booking.consignmentId,
                  trackingCode: booking.trackingCode,
              })
            : null,
    events: booking.events ?? [],
});

const result = (value: BdCourierBooking | CourierActionError) =>
    value instanceof CourierActionError ? new BdCourierError(value.code, value.detail) : view(value);

function courierAndMode(courier: string, mode: string) {
    if (!isCourier(courier) || !(COURIER_MODES as readonly string[]).includes(mode)) {
        throw new UserInputError('Unknown courier or mode');
    }
    return { courier, mode: mode as CourierMode };
}

@Resolver()
export class CourierAdminResolver {
    constructor(
        private couriers: CourierService,
        private settings: CourierSettingsService,
        private connection: TransactionalConnection,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings)
    async bdCourierSetup(@Ctx() ctx: RequestContext) {
        // Webhook secrets are for staff who set couriers up.
        const canSee = ctx.userHasPermissions([updateStoreSettingsPermission.Permission]);
        const webhooks = [];
        for (const courier of COURIERS) {
            const secret = canSee ? await this.settings.webhookSecret(ctx, courier) : null;
            webhooks.push({ courier, secret, url: this.couriers.webhookUrl(courier, secret) });
        }
        return {
            settings: await this.settings.get(ctx),
            credentials: await this.settings.credentialViews(ctx),
            webhooks,
            keyringConfigured: this.settings.keyringConfigured,
            pathaoCities: await this.connection
                .getRepository(ctx, BdCourierLocation)
                .count({ where: { courier: 'pathao', kind: 'city' } }),
        };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async updateBdCourierSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        const saved = await this.settings.update(ctx, args.input);
        return { settings: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async saveBdCourierCredentials(
        @Ctx() ctx: RequestContext,
        @Args() args: { courier: string; mode: string; input: unknown },
    ) {
        const { courier, mode } = courierAndMode(args.courier, args.mode);
        const saved = await this.settings.saveCredentials(ctx, courier, mode, args.input);
        return { credentials: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async testBdCourierConnection(
        @Ctx() ctx: RequestContext,
        @Args() args: { courier: string; mode: string },
    ) {
        const { courier, mode } = courierAndMode(args.courier, args.mode);
        const tested = await this.couriers.testConnection(ctx, courier, mode);
        return { ok: tested.ok, message: 'message' in tested ? tested.message : null };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async syncBdPathaoLocations(@Ctx() ctx: RequestContext) {
        try {
            return await this.couriers.syncPathaoLocations(ctx);
        } catch (error) {
            if (error instanceof CourierActionError)
                throw new UserInputError(`errorResult.BD_COURIER.${error.code}`);
            throw error;
        }
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async bdPathaoStores(@Ctx() ctx: RequestContext) {
        const handle = await this.couriers.handle(ctx, 'pathao', await this.settings.mode(ctx, 'pathao'));
        return handle ? pathaoDriver.stores(handle.call) : [];
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdCourierBooking(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        const booking = await this.couriers.bookingFor(ctx, args.orderId);
        return booking ? view(booking) : null;
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdPathaoCities(@Ctx() ctx: RequestContext) {
        return (await this.couriers.locations(ctx, 'city')).map(place => ({
            id: place.externalId,
            name: place.name,
        }));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdPathaoZones(@Ctx() ctx: RequestContext, @Args() args: { cityId: number }) {
        return (await this.couriers.locations(ctx, 'zone', args.cityId)).map(place => ({
            id: place.externalId,
            name: place.name,
        }));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdUnmappedAddresses(@Ctx() ctx: RequestContext) {
        const language = ctx.languageCode === 'en' ? 'en' : 'bn';
        return (await this.couriers.unmapped(ctx)).map(group => ({
            ...group,
            districtName: findDistrict(group.districtId)?.[language] ?? group.districtId,
            thanaName: findThana(group.thanaId)?.[language] ?? group.thanaId,
        }));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    bdCourierCounts(@Ctx() ctx: RequestContext) {
        return this.couriers.counts(ctx);
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async bookBdCourier(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID; courier?: string | null }) {
        return result(await this.couriers.book(ctx, args.orderId, args.courier));
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async bookBdCouriers(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderIds: ID[]; courier?: string | null },
    ) {
        if (args.orderIds.length > 100) throw new UserInputError('At most 100 orders at once');
        try {
            return await this.couriers.bookMany(ctx, args.orderIds, args.courier);
        } catch (error) {
            if (error instanceof CourierActionError)
                throw new UserInputError(`errorResult.BD_COURIER.${error.code}`);
            throw error;
        }
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async markBdCourierBooked(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderId: ID; courierName: string; trackingCode: string },
    ) {
        return result(await this.couriers.markBookedManually(ctx, args));
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async cancelBdCourierBooking(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return result(await this.couriers.cancelBooking(ctx, args.orderId));
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    async checkBdCourierStatus(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        const booking = await this.couriers.bookingFor(ctx, args.orderId);
        if (!booking) return null;
        const checked = await this.couriers.check(ctx, booking.id);
        return checked ? view(checked) : null;
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async setBdPathaoMapping(
        @Ctx() ctx: RequestContext,
        @Args() args: { districtId: string; thanaId: string; cityId: number; zoneId: number },
    ) {
        try {
            await this.couriers.setPathaoMapping(ctx, args);
            return true;
        } catch (error) {
            if (error instanceof CourierActionError)
                throw new UserInputError(`errorResult.BD_COURIER.${error.code}`);
            throw error;
        }
    }
}

@Resolver('BdCourierBookingResult')
export class BdCourierBookingResultResolver {
    @ResolveField()
    __resolveType(value: unknown): string {
        return value instanceof ErrorResult ? 'BdCourierError' : 'BdCourierBooking';
    }
}
