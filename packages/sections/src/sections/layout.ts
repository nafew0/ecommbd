import { defineSection, SYSTEM_LAYOUTS } from '../define';
import { field } from '../fields';

export const divider = defineSection({
    type: 'divider',
    version: 1,
    name: { bn: 'ফাঁকা জায়গা বা দাগ', en: 'Divider' },
    description: { bn: 'দুই সেকশনের মাঝে ফাঁকা জায়গা বা একটি দাগ', en: 'Space or a line between sections' },
    category: 'layout',
    icon: 'divider',
    fields: {
        line: field.toggle({ bn: 'দাগ দেখান', en: 'Show a line' }, true),
    },
    style: { spacing: 's' },
});

/**
 * Where a system page's own part goes (phase 60): the product on the product page, the checkout
 * form on the checkout, the store's header in the header. It has no settings: the store draws it.
 * The editor names it by the page it is on (`SYSTEM_PAGES`).
 */
export const pageContent = defineSection({
    type: 'page-content',
    version: 1,
    name: { bn: 'পেজের মূল অংশ', en: 'Page content' },
    description: {
        bn: 'এই পেজের নিজস্ব অংশ, যা স্টোর নিজেই দেখায়',
        en: 'This page’s own part, which the store shows itself',
    },
    category: 'layout',
    icon: 'lock',
    layouts: SYSTEM_LAYOUTS,
    fields: {},
});
