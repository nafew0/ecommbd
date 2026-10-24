import { type OnApplicationBootstrap } from '@nestjs/common';
import {
    I18nService,
    type OrderProcess,
    Permission,
    PluginCommonModule,
    RoleService,
    ScheduledTask,
    type Type,
    VendurePlugin,
} from '@vendure/core';
import { registerStoreDefaults, type StoreDefaultsStep } from '../bd-core';
import { BdOrdersPlugin, registerShipmentInfo } from '../bd-orders';
import { registerOrderEditGuard } from '../bd-manual-orders/edit-guard';
import { courierAdminApiExtensions } from './api';
import { bookCourierPermission, COURIERS_OPTIONS } from './constants';
import { CourierService } from './courier.service';
import { CourierSettingsService } from './courier-settings.service';
import { BdCourierBooking, BdCourierLocation, BdCourierLocationMap } from './entities';
import { courierTranslations } from './i18n';
import { BdCourierBookingResultResolver, CourierAdminResolver } from './resolvers';
import type { CouriersPluginOptions } from './types';
import { CourierWebhookController } from './webhook.controller';

/** Who may book couriers, among the default roles (phase 02). */
const GRANTS = ['owner', 'manager', 'order-staff', 'packer'];

const courierPermissionsStep: StoreDefaultsStep = {
    id: 'courier-permissions',
    description: 'BookCourier for the Owner, Manager, Order staff and Packer roles',
    async run({ ctx, injector }) {
        const roleService = injector.get(RoleService);
        const roles = await roleService.findAll(ctx, { take: 200 });
        const notes: string[] = [];
        const permission = bookCourierPermission.Permission;
        for (const role of roles.items) {
            if (!GRANTS.includes(role.code) || role.permissions.includes(permission as never)) continue;
            await roleService.update(ctx, {
                id: role.id,
                permissions: [...role.permissions, permission] as never,
            });
            notes.push(`${role.code}: ${permission}`);
        }
        return notes;
    },
};

registerStoreDefaults(courierPermissionsStep);

let service: CourierService | undefined;

// Editing a booked order would leave the courier with the old parcel and COD amount (phase 05/11a).
registerOrderEditGuard(async (ctx, order) =>
    service && (await service.hasLiveBooking(ctx, order.id)) ? 'COURIER_BOOKED' : null,
);
registerShipmentInfo((ctx, orderId) =>
    service ? service.shipmentInfo(ctx, orderId) : Promise.resolve(null),
);

/** A booked parcel would still be picked up: cancel the booking before cancelling the order. */
const cancelGuard: OrderProcess<never> = {
    async onTransitionStart(_fromState, toState, { ctx, order }) {
        if (toState === 'Cancelled' && service && (await service.hasLiveBooking(ctx, order.id))) {
            return 'message.couriers.cancel-booking-first';
        }
    },
};

const pollTask = new ScheduledTask({
    id: 'bd-poll-couriers',
    description: 'Ask the couriers about active parcels (webhook fallback)',
    schedule: '*/30 * * * *',
    async execute({ injector }) {
        return { checked: await injector.get(CourierService).poll() };
    },
});

const locationsTask = new ScheduledTask({
    id: 'bd-sync-pathao-locations',
    description: "Refresh Pathao's cities and zones",
    schedule: '0 3 * * 1',
    async execute({ injector }) {
        const couriers = injector.get(CourierService);
        const ctx = await couriers.background();
        if (!(await couriers.handle(ctx, 'pathao'))) return { skipped: true };
        return couriers.syncPathaoLocations(ctx);
    },
});

/**
 * Couriers (roadmap phase 19): Steadfast and Pathao. Book one order or many, a manual fallback,
 * status by webhook and polling moving orders to Shipped, Delivered (COD settled) or Returned,
 * Pathao's places matched to our districts and thanas (with an unmapped addresses screen), the
 * consignment on stickers and the courier's link on the tracking page, and the home widget.
 */
@VendurePlugin({
    imports: [PluginCommonModule, BdOrdersPlugin],
    entities: [BdCourierBooking, BdCourierLocation, BdCourierLocationMap],
    controllers: [CourierWebhookController],
    providers: [
        { provide: COURIERS_OPTIONS, useFactory: () => CouriersPlugin.options },
        CourierSettingsService,
        CourierService,
    ],
    exports: [CourierService],
    adminApiExtensions: {
        schema: courierAdminApiExtensions,
        resolvers: [CourierAdminResolver, BdCourierBookingResultResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions = [
            ...(config.authOptions.customPermissions ?? []),
            bookCourierPermission,
        ];
        config.orderOptions.process = [...(config.orderOptions.process ?? []), cancelGuard];
        config.schedulerOptions.tasks = [...(config.schedulerOptions.tasks ?? []), pollTask, locationsTask];
        config.settingsStoreFields = {
            ...config.settingsStoreFields,
            couriers: [
                {
                    name: 'settings',
                    readonly: true,
                    requiresPermission: { read: Permission.ReadSettings, write: Permission.SuperAdmin },
                },
                {
                    // Encrypted, and readable only by our own service: never through an API.
                    name: 'credentials',
                    readonly: true,
                    requiresPermission: { read: Permission.SuperAdmin, write: Permission.SuperAdmin },
                },
            ],
        };
        return config;
    },
    compatibility: '^3.8.0',
})
export class CouriersPlugin implements OnApplicationBootstrap {
    static options: CouriersPluginOptions = {};

    static init(options: CouriersPluginOptions): Type<CouriersPlugin> {
        CouriersPlugin.options = options;
        return CouriersPlugin;
    }

    constructor(
        private i18n: I18nService,
        private couriers: CourierService,
    ) {}

    onApplicationBootstrap() {
        service = this.couriers;
        this.i18n.addTranslation('en', courierTranslations.en);
        this.i18n.addTranslation('bn', courierTranslations.bn);
    }
}
