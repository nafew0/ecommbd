import type { Courier } from '@ecommbd/shared';
import { PermissionDefinition } from '@vendure/core';

export const loggerCtx = 'CouriersPlugin';

export const COURIERS_OPTIONS = Symbol('COURIERS_OPTIONS');

/** Keys in Vendure's settings store. Credentials and webhook secrets are encrypted and never readable through an API. */
export const COURIER_SETTINGS_KEY = 'couriers.settings';
export const COURIER_SECRETS_KEY = 'couriers.credentials';

/** Where couriers send status updates: `<STOREFRONT_URL>/bd-courier/webhook/<courier>/<secret>` (proxied to the core). */
export const COURIER_ROUTE = 'bd-courier';

export const COURIER_NAMES: Record<Courier, string> = { steadfast: 'Steadfast', pathao: 'Pathao' };

/** Order history entry for every booking and courier status. */
export const COURIER_HISTORY_TYPE = 'BD_COURIER' as const;

/** The job that books one order (bulk booking). */
export const BOOK_JOB = 'bd-book-courier';

export const bookCourierPermission = new PermissionDefinition({
    name: 'BookCourier',
    description: 'Book parcels with couriers, mark them booked by hand, and cancel bookings before pickup',
});
