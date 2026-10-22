import { createHttpClient, type HttpClient, HttpError } from '@ecommbd/shared';
import { sourceRecord, type WooRecord } from './helpers';

export const REST_STAGES = ['categories', 'tags', 'products', 'customers', 'orders'] as const;
export type Resource = (typeof REST_STAGES)[number] | 'coupons' | 'reviews';
const ROUTES: Record<string, string> = {
    categories: 'products/categories',
    tags: 'products/tags',
    reviews: 'products/reviews',
};
export interface SourcePage {
    records: WooRecord[];
    size: number;
    total: number | null;
}
export interface SourceConnector {
    page(
        kind: Resource,
        offset: number,
        size: number,
        after?: Date | null,
        before?: Date,
    ): Promise<SourcePage>;
    children(path: string): Promise<WooRecord[]>;
    close(): Promise<void>;
}

/** Only authenticated GETs to the exact source host. Credentials never enter URLs or logs. */
export class WooRestConnector implements SourceConnector {
    private client: HttpClient;
    private authorization: string;
    private api: URL;
    constructor(url: string, credentials: { key: string; secret: string }) {
        this.api = new URL(`${url.replace(/\/$/, '')}/wp-json/wc/v3/`);
        if (this.api.protocol !== 'https:' || this.api.username || this.api.password)
            throw new Error('HTTPS_SOURCE_REQUIRED');
        this.authorization = `Basic ${Buffer.from(`${credentials.key}:${credentials.secret}`).toString('base64')}`;
        this.client = createHttpClient({
            maxResponseBytes: 12 * 1024 * 1024,
            maxRedirects: 0,
            // This bounded batch reader stops at size 10 after a failure. Let size reduction
            // happen even when a larger page repeatedly times out; it is its own stop condition.
            circuitBreaker: false,
            maxRetries: 2,
            timeoutMs: 20_000,
        });
    }
    async page(
        kind: Resource,
        offset: number,
        size: number,
        after?: Date | null,
        before?: Date,
    ): Promise<SourcePage> {
        const path = ROUTES[kind] ?? kind;
        if (![...REST_STAGES, 'coupons', 'reviews'].includes(kind))
            throw new Error('INVALID_SOURCE_RESOURCE');
        return this.readPage(
            path,
            offset,
            size,
            kind === 'products' || kind === 'orders' ? { after, before } : undefined,
        );
    }

    async inspectSettings() {
        const get = async (path: string) => {
            try {
                const response = await this.client.request(new URL(path, this.api), {
                    headers: { authorization: this.authorization },
                });
                return response.status === 200 ? response.json<WooRecord>() : null;
            } catch {
                return null;
            }
        };
        const [currency, tax] = await Promise.all([
            get('settings/general/woocommerce_currency'),
            get('settings/tax/woocommerce_prices_include_tax'),
        ]);
        const [weight, enabled] = await Promise.all([
            get('settings/products/woocommerce_weight_unit'),
            get('settings/general/woocommerce_calc_taxes'),
        ]);
        const status = await get('system_status');
        return {
            currency: typeof currency?.value === 'string' ? currency.value : null,
            pricesIncludeTax: tax?.value === 'yes' ? true : tax?.value === 'no' ? false : null,
            taxesEnabled: enabled?.value === 'yes' ? true : enabled?.value === 'no' ? false : null,
            weightUnit: typeof weight?.value === 'string' ? weight.value : null,
            wooVersion: typeof status?.environment?.version === 'string' ? status.environment.version : null,
            wordpressVersion:
                typeof status?.environment?.wp_version === 'string' ? status.environment.wp_version : null,
        };
    }
    private async readPage(
        path: string,
        offset: number,
        initialSize: number,
        window?: { after?: Date | null; before?: Date },
    ): Promise<SourcePage> {
        let size = initialSize;
        for (;;) {
            const url = new URL(path, this.api);
            if (!url.href.startsWith(this.api.href)) throw new Error('INVALID_SOURCE_ENDPOINT');
            url.searchParams.set('per_page', String(size));
            url.searchParams.set('offset', String(offset));
            url.searchParams.set('orderby', 'id');
            url.searchParams.set('order', 'asc');
            if (path === 'products' || path === 'orders') url.searchParams.set('status', 'any');
            if (window) {
                url.searchParams.set('dates_are_gmt', 'true');
                if (window.after) url.searchParams.set('modified_after', window.after.toISOString());
                if (window.before) url.searchParams.set('before', window.before.toISOString());
            }
            try {
                const response = await this.client.request(url, {
                    headers: { authorization: this.authorization },
                });
                if (response.status === 401 || response.status === 403)
                    throw new Error('SOURCE_AUTH_OR_FIREWALL');
                if ((response.status >= 500 || response.status === 429) && size > 10) {
                    size = size > 50 ? 50 : size > 20 ? 20 : 10;
                    continue;
                }
                if (response.status !== 200) throw new Error(`SOURCE_HTTP_${response.status}`);
                const data = response.json<unknown>();
                if (!Array.isArray(data)) throw new Error('INVALID_SOURCE_RESPONSE');
                const totalHeader = response.headers.get('x-wp-total');
                return {
                    records: data.map(sourceRecord),
                    size,
                    total: totalHeader && /^\d+$/.test(totalHeader) ? Number(totalHeader) : null,
                };
            } catch (error) {
                if (
                    error instanceof HttpError &&
                    ['timeout', 'network', 'too_large'].includes(error.kind) &&
                    size > 10
                ) {
                    size = size > 50 ? 50 : size > 20 ? 20 : 10;
                    continue;
                }
                throw error instanceof HttpError ? new Error(`SOURCE_${error.kind.toUpperCase()}`) : error;
            }
        }
    }
    async children(path: string): Promise<WooRecord[]> {
        if (!/^(products\/\d+\/variations|orders\/\d+\/(notes|refunds))$/.test(path))
            throw new Error('INVALID_SOURCE_ENDPOINT');
        const records: WooRecord[] = [];
        let offset = 0;
        for (;;) {
            const page = await this.readPage(path, offset, 100);
            records.push(...page.records);
            offset += page.records.length;
            if (page.records.length < page.size) return records;
            if (offset > 10_000) throw new Error('SOURCE_CHILD_LIMIT');
        }
    }
    close() {
        return this.client.close();
    }
}
