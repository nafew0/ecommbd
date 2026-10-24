import {
    type CourierCall,
    type CourierDriver,
    CourierError,
    courierDate,
    jsonOf,
    messageOf,
    type ParcelInput,
    str,
    type WebhookReading,
} from './types';

/**
 * Pathao Courier merchant API (aladdin v1): an access token from a password grant (client ID and
 * secret plus the merchant's login), refreshed when it expires; cities and zones to address parcels;
 * create an order in the merchant's store; view an order. Webhooks carry the secret the merchant set
 * in Pathao's panel in `X-PATHAO-Signature`; the first call is an integration handshake.
 */

interface CachedToken {
    token: string;
    refreshToken: string;
    expiresAt: number;
}

const tokens = new Map<string, CachedToken>();
const EARLY_MS = 5 * 60_000;

/** For tests. */
export function clearPathaoTokens(): void {
    tokens.clear();
}

const url = (call: CourierCall, path: string) => `${call.baseUrl.replace(/\/$/, '')}/aladdin/api/v1/${path}`;
const key = (call: CourierCall) =>
    `${call.baseUrl}|${call.credentials.clientId}|${call.credentials.username}`;

async function issue(call: CourierCall, refreshToken?: string): Promise<CachedToken> {
    const body = jsonOf(
        await call.http.request(url(call, 'issue-token'), {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(
                refreshToken
                    ? {
                          client_id: call.credentials.clientId,
                          client_secret: call.credentials.clientSecret,
                          grant_type: 'refresh_token',
                          refresh_token: refreshToken,
                      }
                    : {
                          client_id: call.credentials.clientId,
                          client_secret: call.credentials.clientSecret,
                          grant_type: 'password',
                          username: call.credentials.username,
                          password: call.credentials.password,
                      },
            ),
            idempotent: true,
        }),
    );
    const token = str(body.access_token);
    if (!token) throw new CourierError(`Pathao refused the credentials (${messageOf(body)})`, null, true);
    const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    return { token, refreshToken: str(body.refresh_token) ?? '', expiresAt: Date.now() + seconds * 1000 };
}

async function token(call: CourierCall, fresh = false): Promise<string> {
    const cached = tokens.get(key(call));
    if (!fresh && cached && cached.expiresAt - EARLY_MS > Date.now()) return cached.token;
    let next: CachedToken;
    try {
        next = cached?.refreshToken && !fresh ? await issue(call, cached.refreshToken) : await issue(call);
    } catch (error) {
        if (!cached?.refreshToken || fresh) throw error;
        next = await issue(call);
    }
    tokens.set(key(call), next);
    return next.token;
}

/** A call with the token; an expired token (401) is replaced once, also in the middle of a bulk job. */
async function api(
    call: CourierCall,
    path: string,
    init: { method?: string; body?: unknown; idempotent?: boolean } = {},
) {
    for (let round = 0; ; round++) {
        const response = await call.http.request(url(call, path), {
            method: init.method ?? 'GET',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                authorization: `Bearer ${await token(call, round > 0)}`,
            },
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            idempotent: init.idempotent,
        });
        if (response.status === 401 && round === 0) continue;
        return { status: response.status, body: jsonOf(response) };
    }
}

const listOf = (body: Record<string, unknown>) => {
    const data = body.data as Record<string, unknown> | undefined;
    const list = data?.data ?? data;
    return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
};

export const pathaoDriver: CourierDriver & {
    cities(call: CourierCall): Promise<Array<{ id: number; name: string }>>;
    zones(call: CourierCall, cityId: number): Promise<Array<{ id: number; name: string }>>;
    stores(call: CourierCall): Promise<Array<{ id: string; name: string }>>;
} = {
    async testConnection(call) {
        try {
            await token(call, true);
            return { ok: true };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    },

    async cities(call) {
        const { body } = await api(call, 'countries/1/city-list', { idempotent: true });
        return listOf(body).map(item => ({ id: Number(item.city_id), name: str(item.city_name) ?? '' }));
    },

    async zones(call, cityId) {
        const { body } = await api(call, `cities/${cityId}/zone-list`, { idempotent: true });
        return listOf(body).map(item => ({ id: Number(item.zone_id), name: str(item.zone_name) ?? '' }));
    },

    async stores(call) {
        const { body } = await api(call, 'stores', { idempotent: true });
        return listOf(body).map(item => ({ id: str(item.store_id) ?? '', name: str(item.store_name) ?? '' }));
    },

    async createParcel(call, parcel: ParcelInput) {
        const pathao = parcel.pathao;
        if (!pathao) throw new CourierError('No Pathao address', null, true);
        const { status, body } = await api(call, 'orders', {
            method: 'POST',
            body: {
                store_id: Number(pathao.storeId),
                merchant_order_id: parcel.invoice,
                recipient_name: parcel.recipientName.slice(0, 100),
                recipient_phone: parcel.recipientPhone,
                recipient_address: parcel.recipientAddress.slice(0, 220),
                recipient_city: pathao.cityId,
                recipient_zone: pathao.zoneId,
                ...(pathao.areaId ? { recipient_area: pathao.areaId } : {}),
                delivery_type: pathao.deliveryType,
                item_type: pathao.itemType,
                special_instruction: parcel.note.slice(0, 250),
                item_quantity: parcel.itemQuantity,
                item_weight: parcel.weightKg,
                item_description: parcel.itemDescription.slice(0, 250),
                amount_to_collect: parcel.codAmount,
            },
        });
        const data = body.data as Record<string, unknown> | undefined;
        const id = str(data?.consignment_id);
        if (!id) {
            throw new CourierError(`Pathao refused the parcel: ${messageOf(body)}`, body, status < 500);
        }
        const fee = Number(data?.delivery_fee);
        return {
            consignmentId: id,
            trackingCode: null,
            status: str(data?.order_status) ?? 'Pending',
            deliveryFee: Number.isFinite(fee) ? Math.round(fee * 100) : null,
            raw: body,
        };
    },

    async getStatus(call, consignmentId) {
        const { body } = await api(call, `orders/${encodeURIComponent(consignmentId)}/info`, {
            idempotent: true,
        });
        const data = body.data as Record<string, unknown> | undefined;
        const status = str(data?.order_status_slug) ?? str(data?.order_status);
        if (!status) throw new CourierError(`Pathao status failed: ${messageOf(body)}`, body);
        return { status, at: courierDate(data?.updated_at), raw: body };
    },

    readWebhook(body): WebhookReading {
        const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        if (input.event === 'webhook_integration') return { kind: 'handshake' };
        const consignmentId = str(input.consignment_id);
        const status = str(input.event) ?? str(input.order_status);
        if (!consignmentId || !status) return { kind: 'ignored', reason: 'no consignment_id or event' };
        return {
            kind: 'status',
            consignmentId,
            status,
            at: courierDate(input.updated_at) ?? courierDate(input.timestamp),
            raw: input,
        };
    },
};
