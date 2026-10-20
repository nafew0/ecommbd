import { dataVersion } from '@ecommbd/bd-geo';
import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { Allow, Permission } from '@vendure/core';
import { districtList, thanaList, toGeoLanguage } from './geo-lists';

interface CacheableResponse {
    setHeader(name: string, value: string): void;
    status(code: number): unknown;
}

/** A day fresh, then served stale for a week while revalidating. The data changes only with a release. */
const CACHE_CONTROL = 'public, max-age=86400, stale-while-revalidate=604800';

/**
 * The same lists as plain GET requests, so browsers, the storefront and Varnish can cache them by
 * URL (GraphQL POSTs aren't cached). The ETag is the data version, so a revalidation is a 304.
 *
 *   GET /bd-geo/districts?lang=bn
 *   GET /bd-geo/districts/BD3026/thanas?lang=bn
 */
@Controller('bd-geo')
export class BdGeoController {
    @Get('districts')
    @Allow(Permission.Public)
    districts(
        @Query('lang') lang: string | undefined,
        @Headers('if-none-match') ifNoneMatch: string | undefined,
        @Res({ passthrough: true }) res: CacheableResponse,
    ) {
        const language = toGeoLanguage(lang);
        if (this.notModified(res, `districts-${language}`, ifNoneMatch)) {
            return;
        }
        return { dataVersion, districts: districtList(language) };
    }

    @Get('districts/:districtId/thanas')
    @Allow(Permission.Public)
    thanas(
        @Param('districtId') districtId: string,
        @Query('lang') lang: string | undefined,
        @Headers('if-none-match') ifNoneMatch: string | undefined,
        @Res({ passthrough: true }) res: CacheableResponse,
    ) {
        const language = toGeoLanguage(lang);
        if (this.notModified(res, `thanas-${districtId}-${language}`, ifNoneMatch)) {
            return;
        }
        return { dataVersion, thanas: thanaList(districtId, language) };
    }

    /** Sets the cache headers; answers 304 when the client already has this version. */
    private notModified(res: CacheableResponse, key: string, ifNoneMatch: string | undefined): boolean {
        const etag = `"${dataVersion}-${key.replace(/[^\w-]/g, '')}"`;
        res.setHeader('Cache-Control', CACHE_CONTROL);
        res.setHeader('ETag', etag);
        if (ifNoneMatch?.split(',').some(tag => tag.trim().replace(/^W\//, '') === etag)) {
            res.status(304);
            return true;
        }
        return false;
    }
}
