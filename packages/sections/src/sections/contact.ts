import { defineSection } from '../define';
import { field } from '../fields';
import { heading, L, text } from './common';

export const contact = defineSection({
    type: 'contact',
    version: 1,
    name: { bn: 'যোগাযোগ', en: 'Contact' },
    description: {
        bn: 'ফোন, হোয়াটসঅ্যাপ, মেসেঞ্জার, ঠিকানা আর খোলার সময়, স্টোর সেটিংস থেকে',
        en: 'Phone, WhatsApp, Messenger, address and opening hours, from your store settings',
    },
    category: 'contact',
    icon: 'contact',
    fields: {
        heading: heading({ bn: 'যোগাযোগ করুন', en: 'Contact us' }),
        text: text({
            bn: 'অর্ডার বা যেকোনো প্রশ্নে আমাদের ফোন বা মেসেজ দিন।',
            en: 'Call or message us to order or with any question.',
        }),
        showPhone: field.toggle({ bn: 'ফোন নম্বর', en: 'Phone number' }, true),
        showWhatsapp: field.toggle({ bn: 'হোয়াটসঅ্যাপ', en: 'WhatsApp' }, true),
        showMessenger: field.toggle({ bn: 'মেসেঞ্জার', en: 'Messenger' }, true),
        showEmail: field.toggle({ bn: 'ইমেইল', en: 'Email' }, false),
        showAddress: field.toggle({ bn: 'ঠিকানা', en: 'Address' }, true),
        showHours: field.toggle({ bn: 'খোলার সময়', en: 'Opening hours' }, true),
    },
});

export const whatsappCta = defineSection({
    type: 'whatsapp-cta',
    version: 1,
    name: { bn: 'হোয়াটসঅ্যাপে অর্ডার', en: 'Order on WhatsApp' },
    description: {
        bn: 'হোয়াটসঅ্যাপ, কল বা মেসেঞ্জারে অর্ডার করতে বলুন',
        en: 'Invite shoppers to order by WhatsApp, a call or Messenger',
    },
    category: 'contact',
    icon: 'whatsapp-cta',
    fields: {
        heading: heading({ bn: 'হোয়াটসঅ্যাপে অর্ডার করুন', en: 'Order on WhatsApp' }),
        text: text({
            bn: 'পণ্যের ছবি বা নাম পাঠান, আমরা বাকিটা দেখছি।',
            en: 'Send us a photo or the product’s name and we’ll take care of the rest.',
        }),
        message: field.text(
            { bn: 'হোয়াটসঅ্যাপে আগে থেকে লেখা মেসেজ', en: 'Ready-made WhatsApp message' },
            {
                bn: 'আমি অর্ডার করতে চাই',
                en: 'I’d like to place an order',
            },
            { max: 200 },
        ),
        showWhatsapp: field.toggle({ bn: 'হোয়াটসঅ্যাপ বাটন', en: 'WhatsApp button' }, true),
        showCall: field.toggle({ bn: 'কল বাটন', en: 'Call button' }, true),
        showMessenger: field.toggle({ bn: 'মেসেঞ্জার বাটন', en: 'Messenger button' }, false),
        image: field.image(L.image),
    },
    style: { background: 'subtle', align: 'center' },
});
