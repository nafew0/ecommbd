import type { ConfigService, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';
import { assetUrl } from '../../src/plugins/bd-catalog/asset-url';

const withStrategy = (toAbsoluteUrl?: (request: unknown, identifier: string) => string) =>
    ({ assetOptions: { assetStorageStrategy: { toAbsoluteUrl } } }) as unknown as ConfigService;
const ctx = { req: {} } as unknown as RequestContext;
const prefixed = withStrategy((_request, identifier) => `https://shop.example.com/assets/${identifier}`);

describe('assetUrl (images in the admin lists)', () => {
    it('completes a stored path the way Vendure completes its own Asset fields', () => {
        expect(assetUrl(prefixed, ctx, 'preview/a3/photo__preview.jpg')).toBe(
            'https://shop.example.com/assets/preview/a3/photo__preview.jpg',
        );
    });

    it('keeps a missing image missing', () => {
        expect(assetUrl(prefixed, ctx, null)).toBeNull();
        expect(assetUrl(prefixed, ctx, undefined)).toBeNull();
    });

    it('keeps the stored path when there is no request or no way to complete it', () => {
        expect(assetUrl(prefixed, {} as RequestContext, 'preview/a3/x.jpg')).toBe('preview/a3/x.jpg');
        expect(assetUrl(withStrategy(), ctx, 'preview/a3/x.jpg')).toBe('preview/a3/x.jpg');
    });
});
