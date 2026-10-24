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
 * Steadfast (portal.packzy.com API v1): API key and secret key headers; create an order with our
 * order number as the invoice; status by consignment ID. Status updates come by webhook (the merchant
 * sets our URL and a Bearer token in Steadfast's panel) with polling as the fallback.
 */

const headers = (call: CourierCall) => ({
    'content-type': 'application/json',
    accept: 'application/json',
    'api-key': call.credentials.apiKey ?? '',
    'secret-key': call.credentials.secretKey ?? '',
});

const url = (call: CourierCall, path: string) => `${call.baseUrl.replace(/\/$/, '')}/${path}`;

export const steadfastDriver: CourierDriver = {
    async testConnection(call) {
        try {
            const body = jsonOf(
                await call.http.request(url(call, 'get_balance'), { headers: headers(call) }),
            );
            return Number(body.status) === 200
                ? { ok: true }
                : { ok: false, message: `Steadfast refused the keys (${messageOf(body)})` };
        } catch (error) {
            return { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
    },

    async createParcel(call, parcel: ParcelInput) {
        const response = await call.http.request(url(call, 'create_order'), {
            method: 'POST',
            headers: headers(call),
            body: JSON.stringify({
                invoice: parcel.invoice,
                recipient_name: parcel.recipientName.slice(0, 100),
                recipient_phone: parcel.recipientPhone,
                recipient_address: parcel.recipientAddress.slice(0, 250),
                cod_amount: parcel.codAmount,
                note: parcel.note.slice(0, 250),
                item_description: parcel.itemDescription.slice(0, 250),
                total_lot: parcel.itemQuantity,
                delivery_type: 0,
            }),
        });
        const body = jsonOf(response);
        const consignment = body.consignment as Record<string, unknown> | undefined;
        const id = str(consignment?.consignment_id);
        if (Number(body.status) !== 200 || !id) {
            throw new CourierError(
                `Steadfast refused the parcel: ${messageOf(body)}`,
                body,
                response.status < 500,
            );
        }
        return {
            consignmentId: id,
            trackingCode: str(consignment?.tracking_code),
            status: str(consignment?.status) ?? 'in_review',
            deliveryFee: null,
            raw: body,
        };
    },

    async getStatus(call, consignmentId) {
        const body = jsonOf(
            await call.http.request(url(call, `status_by_cid/${encodeURIComponent(consignmentId)}`), {
                headers: headers(call),
            }),
        );
        const status = str(body.delivery_status);
        if (!status) throw new CourierError(`Steadfast status failed: ${messageOf(body)}`, body);
        return { status, at: null, raw: body };
    },

    readWebhook(body): WebhookReading {
        const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        const consignmentId = str(input.consignment_id);
        const status = str(input.status) ?? str(input.delivery_status);
        // tracking_update messages carry no status: kept as a note only.
        if (!consignmentId) return { kind: 'ignored', reason: 'no consignment_id' };
        return {
            kind: 'status',
            consignmentId,
            status: status ?? 'tracking_update',
            at: courierDate(input.updated_at),
            raw: input,
        };
    },
};
