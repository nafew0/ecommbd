import { defineSection } from '../define';
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
