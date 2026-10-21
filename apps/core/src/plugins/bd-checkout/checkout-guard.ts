import { findDistrict, isThanaInDistrict, OTHER_THANA_ID } from '@ecommbd/bd-geo';
import { parseCheckoutPhone } from '@ecommbd/shared';
import type { Order, OrderProcess } from '@vendure/core';
import { CheckoutSettingsService } from './checkout-settings.service';

/**
 * No payment without a valid phone and a Bangladesh address (roadmap phase 03). Runs for every way
 * into `ArrangingPayment`: our checkout, Vendure's own `setCustomerForOrder` (older clients) and
 * admin draft orders. Messages are translated from `message.bd-checkout.*` (i18n.ts).
 */
export function createCheckoutGuard(): OrderProcess<never> {
    let settings: CheckoutSettingsService;
    return {
        init(injector) {
            settings = injector.get(CheckoutSettingsService);
        },
        async onTransitionStart(_fromState, toState, { ctx, order }) {
            if (toState !== 'ArrangingPayment') {
                return;
            }
            const phone = order.customer?.customFields?.phone;
            const { allowInternationalPhones } = await settings.get(ctx);
            if (!phone || !parseCheckoutPhone(phone, { allowInternational: allowInternationalPhones }).ok) {
                return 'message.bd-checkout.phone-required';
            }
            if (!hasBangladeshAddress(order.shippingAddress)) {
                return 'message.bd-checkout.address-required';
            }
        },
    };
}

/** The address has a street line and a district/thana pair that bd-geo still recognizes. */
export function hasBangladeshAddress(address: Order['shippingAddress'] | undefined): boolean {
    const fields = (address?.customFields ?? {}) as { districtId?: string; thanaId?: string; area?: string };
    if (!address?.streetLine1?.trim() || !fields.districtId || !fields.thanaId) {
        return false;
    }
    if ((address.countryCode ?? 'BD').toUpperCase() !== 'BD' || !findDistrict(fields.districtId)) {
        return false;
    }
    return fields.thanaId === OTHER_THANA_ID
        ? Boolean(fields.area?.trim())
        : isThanaInDistrict(fields.districtId, fields.thanaId);
}
