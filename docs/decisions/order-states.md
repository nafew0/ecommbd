# ADR: BD order statuses on Vendure's order states

> Accepted 2026-10-21 · Roadmap phase 04 · Code: `packages/shared/src/order-status.ts` (the table below), `apps/core/src/plugins/bd-orders/bd-order-process.ts` (the guard)

## Decision

Merchants see eight statuses. Each maps to one or more Vendure order states:

| Status (en / bn) | Vendure states | Notes |
|---|---|---|
| New / নতুন | `PaymentAuthorized`, `PaymentSettled` | COD and advance orders are `PaymentAuthorized`; fully prepaid ones `PaymentSettled` |
| Confirmed / কনফার্মড | `Confirmed` (ours) | |
| Packed / প্যাকড | `Packed` (ours) | |
| Shipped / পাঠানো হয়েছে | `Shipped`, `PartiallyShipped` | Reached through a fulfillment (manual now, couriers in phase 19) |
| Partly delivered / আংশিক ডেলিভারি | `PartiallyDelivered` | The customer kept some items; returned quantities per line |
| Delivered / ডেলিভারি হয়েছে | `Delivered` | |
| Returned / ফেরত এসেছে | `Returned` (ours) | |
| Cancelled / বাতিল | `Cancelled` | |

Carts, drafts and Vendure's internal states (`AddingItems`, `ArrangingPayment`, `Draft`, `Modifying`, `ArrangingAdditionalPayment`) have no status and keep Vendure's own rules.

**An order counts as placed** with Vendure's default order-placed strategy: when checkout completes (`ArrangingPayment` → `PaymentAuthorized` or `PaymentSettled`), cash on delivery included. That's when it gets its order number and enters the confirmation queue.

## Allowed transitions between placed states

Our order process adds the custom states and refuses every transition between placed states that isn't listed here, even where Vendure's default process would allow it:

| From | To |
|---|---|
| `PaymentAuthorized` (New) | `Confirmed`, `Cancelled`, `PaymentSettled` (payment received, still New), `Modifying`, `ArrangingAdditionalPayment` |
| `PaymentSettled` (New) | `Confirmed`, `Cancelled`, `Modifying`, `ArrangingAdditionalPayment`, and `Packed` only when the store setting "skip confirmation for prepaid orders" is on |
| `Confirmed` | `Packed`, `Cancelled` |
| `Packed` | `Shipped`, `PartiallyShipped`, `Cancelled` |
| `PartiallyShipped` | `Shipped`, `PartiallyDelivered` |
| `Shipped` | `Delivered`, `PartiallyDelivered`, `Returned` |
| `PartiallyDelivered` | `Delivered`, `Returned` |
| `Delivered`, `Returned`, `Cancelled` | nothing |

**Guards:**

- Cancelling a placed order needs a reason code (the order's `cancelReason` field). Our admin's cancel sets it; on Vendure's Dashboard, set the field first.
- Shipped orders can't be cancelled, only returned.
- New orders can't be packed or shipped without confirmation (except prepaid, with the setting above).
- A payment settled after confirmation (for example COD collected on delivery, phase 08) doesn't move the order back to New: Vendure tries `Confirmed` → `PaymentSettled`, the guard refuses it, and the payment is still settled.

Order editing (phase 11a) will add `Confirmed`/`Packed` ↔ `Modifying` with a new row here.

## Why

- Vendure's order process is built to be extended this way, so we stay on upstream releases.
- One table in `packages/shared` drives both the server guard and the admin's buttons, so the admin never offers an action the server refuses.
- Refusing by default (anything not listed) is safer than trying to remove Vendure's default transitions one by one.
