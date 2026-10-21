import type { DeliveryUnavailableReason } from '@ecommbd/shared';

type Reason = Exclude<DeliveryUnavailableReason, 'METHOD_OFF'>;

/** Why an order has no delivery option (`message.shipping-bd.<reason>`). Terms follow docs/glossary.md. */
const en: Record<Reason, string> = {
    NO_DISTRICT: 'Choose the district and thana to see the delivery charge.',
    NOT_DELIVERED_HERE: 'Sorry, we don’t deliver to this area yet.',
    TOO_HEAVY: 'This order is too heavy for delivery. Please remove some items or contact us.',
};

const bn: Record<Reason, string> = {
    NO_DISTRICT: 'ডেলিভারি চার্জ দেখতে জেলা ও থানা বেছে নিন।',
    NOT_DELIVERED_HERE: 'দুঃখিত, এই এলাকায় এখনো আমরা ডেলিভারি দিই না।',
    TOO_HEAVY: 'অর্ডারটি ডেলিভারির জন্য বেশি ভারী। কিছু পণ্য কমান অথবা আমাদের সাথে যোগাযোগ করুন।',
};

export const shippingTranslations = {
    en: { message: { 'shipping-bd': en } },
    bn: { message: { 'shipping-bd': bn } },
};
