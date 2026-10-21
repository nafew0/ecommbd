import type { PrintDocument } from '@ecommbd/shared';
import type { CustomFieldConfig } from '@vendure/core';

/** When each document was last printed for an order (internal: shown through `Order.bdPrint`). */
export const orderPrintCustomFields: CustomFieldConfig[] = [
    { name: 'invoicePrintedAt', type: 'datetime', nullable: true, internal: true },
    { name: 'slipPrintedAt', type: 'datetime', nullable: true, internal: true },
    { name: 'stickerPrintedAt', type: 'datetime', nullable: true, internal: true },
];

/** The field each document is recorded in. A thermal receipt is the invoice on a roll. */
export const PRINTED_FIELD: Record<PrintDocument, 'invoicePrintedAt' | 'slipPrintedAt' | 'stickerPrintedAt'> =
    {
        invoice: 'invoicePrintedAt',
        receipt: 'invoicePrintedAt',
        slip: 'slipPrintedAt',
        sticker: 'stickerPrintedAt',
    };
