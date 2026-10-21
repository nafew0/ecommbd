import type { DeliveryMethod } from '@ecommbd/shared';

export const loggerCtx = 'ShippingBdPlugin';

/** Key in Vendure's settings store. */
export const SHIPPING_SETTINGS_KEY = 'shippingBd.settings';

/** Our checker and calculator (one each; the method argument says which delivery method). */
export const DELIVERY_CHECKER_CODE = 'bd-delivery-eligibility';
export const DELIVERY_CALCULATOR_CODE = 'bd-delivery-rate';

/** The shipping methods every store gets (store defaults), by code. */
export const DELIVERY_METHOD_CODES: Record<DeliveryMethod, string> = {
    standard: 'bd-standard',
    express: 'bd-express',
    pickup: 'bd-pickup',
};
