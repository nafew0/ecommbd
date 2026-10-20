import type { StoreDefaultsStep } from '../store-defaults/registry';
import { StoreSettingsService } from './store-settings.service';

export const storeSettingsStep: StoreDefaultsStep = {
    id: 'store-settings',
    description: 'Store settings with Bangla and English policy templates',
    async run({ ctx, injector, options }) {
        const created = await injector.get(StoreSettingsService).initialize(ctx, options.defaultLanguage);
        return created ? ['store settings created with policy templates to review'] : [];
    },
};
