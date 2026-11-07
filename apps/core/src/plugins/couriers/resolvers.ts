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
import { CourierClients } from './courier-clients.service';
import { CourierService } from './courier.service';
import { CourierSettingsService } from './courier-settings.service';
import { pathaoDriver } from './drivers/pathao';
import { BdCourierLocation, type BdCourierBooking } from './entities';
import { CourierActionError, type CourierErrorCode } from './errors';
import { PathaoPlacesService } from './pathao-places.service';

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

/** A booking as the Admin API shows it: the courier's tracking page, and whether it waits for the courier. */
const view = (booking: BdCourierBooking, couriers: CourierService) => ({
    ...booking,
    trackingUrl:
        booking.consignmentId && isCourier(booking.courier) && booking.status === 'booked'
            ? courierTrackingUrl(booking.courier, {
                  consignmentId: booking.consignmentId,
                  trackingCode: booking.trackingCode,
              })
            : null,
    waitingForCourier: couriers.waiting(booking),
    events: booking.events ?? [],
});

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
        private clients: CourierClients,
        private places: PathaoPlacesService,
        private settings: CourierSettingsService,
        private connection: TransactionalConnection,
    ) {}

    private result(value: BdCourierBooking | CourierActionError) {
        return value instanceof CourierActionError
            ? new BdCourierError(value.code, value.detail)
            : view(value, this.couriers);
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async bdCourierSetup(@Ctx() ctx: RequestContext) {
        // Webhook secrets are for staff who set couriers up; only they make one (on first look).
        const canSee = ctx.userHasPermissions([updateStoreSettingsPermission.Permission]);
        const webhooks = [];
        for (const courier of COURIERS) {
            const secret = canSee ? await this.settings.ensureWebhookSecret(ctx, courier) : null;
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
        const before = (await this.settings.get(ctx)).pathao.mode;
        const saved = await this.settings.update(ctx, args.input);
        // Sandbox and live have their own place IDs: the old mode's copy and maps go.
        if (saved.value && saved.value.pathao.mode !== before) await this.places.forget(ctx);
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
        const tested = await this.clients.testConnection(ctx, courier, mode);
        return { ok: tested.ok, message: 'message' in tested ? tested.message : null };
    }

    @Mutation()
    @Allow(updateStoreSettingsPermission.Permission)
    async syncBdPathaoLocations(@Ctx() ctx: RequestContext) {
        try {
            return await this.places.sync(ctx);
        } catch (error) {
            if (error instanceof CourierActionError)
                throw new UserInputError(`errorResult.BD_COURIER.${error.code}`);
            throw error;
        }
    }

    @Query()
    @Allow(Permission.ReadSettings)
    async bdPathaoStores(@Ctx() ctx: RequestContext) {
        const handle = await this.clients.handle(ctx, 'pathao', await this.settings.mode(ctx, 'pathao'));
        return handle ? pathaoDriver.stores(handle.call) : [];
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdCourierBooking(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        const booking = await this.couriers.bookingFor(ctx, args.orderId);
        return booking ? view(booking, this.couriers) : null;
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdCourierBookings(@Ctx() ctx: RequestContext, @Args() args: { orderIds: ID[] }) {
        if (args.orderIds.length > 100) throw new UserInputError('At most 100 orders at once');
        return (await this.couriers.bookingsFor(ctx, args.orderIds)).map(booking =>
            view(booking, this.couriers),
        );
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdPathaoCities(@Ctx() ctx: RequestContext) {
        return (await this.places.list(ctx, 'city')).map(place => ({
            id: place.externalId,
            name: place.name,
        }));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdPathaoZones(@Ctx() ctx: RequestContext, @Args() args: { cityId: number }) {
        return (await this.places.list(ctx, 'zone', args.cityId)).map(place => ({
            id: place.externalId,
            name: place.name,
        }));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    async bdUnmappedAddresses(@Ctx() ctx: RequestContext) {
        const language = ctx.languageCode === 'en' ? 'en' : 'bn';
        return (await this.places.unmapped(ctx)).map(group => ({
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
        return this.result(await this.couriers.book(ctx, args.orderId, args.courier));
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
        return this.result(await this.couriers.markBookedManually(ctx, args));
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async cancelBdCourierBooking(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.result(await this.couriers.cancelBooking(ctx, args.orderId));
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async resolveBdCourierBooking(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderId: ID; consignmentId?: string | null },
    ) {
        return this.result(await this.couriers.resolveUnconfirmed(ctx, args));
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async confirmBdCourierCodUpdated(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        return this.result(await this.couriers.confirmCodUpdated(ctx, args.orderId));
    }

    @Mutation()
    @Allow(Permission.UpdateOrder)
    async checkBdCourierStatus(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID }) {
        const booking = await this.couriers.bookingFor(ctx, args.orderId);
        if (!booking) return null;
        const checked = await this.couriers.check(ctx, booking.id);
        return checked ? view(checked, this.couriers) : null;
    }

    @Mutation()
    @Allow(bookCourierPermission.Permission)
    async setBdPathaoMapping(
        @Ctx() ctx: RequestContext,
        @Args() args: { districtId: string; thanaId: string; cityId: number; zoneId: number },
    ) {
        try {
            await this.places.setMapping(ctx, args);
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
