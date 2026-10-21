import { I18nError, LogLevel } from '@vendure/core';
import type { ImageRejection } from './pipeline';

/**
 * An upload refused by our checks. The message is translated into the request's language
 * (`error.bd-image.<reason>` in i18n.ts); `extensions.code` is `BD_IMAGE_<REASON>`, e.g.
 * `BD_IMAGE_TOO_LARGE`, so the admin can tell the reasons apart.
 */
export class BdImageRejectedError extends I18nError {
    constructor(readonly reason: ImageRejection) {
        super(
            `error.bd-image.${reason}`,
            {},
            `BD_IMAGE_${reason.toUpperCase().replace(/-/g, '_')}`,
            LogLevel.Info,
        );
    }
}
