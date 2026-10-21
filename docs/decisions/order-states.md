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

- Confirming, packing and cancelling require `ConfirmOrder`, `PackOrder` and `CancelOrder` respectively, including through Vendure's standard mutations. `UpdateOrder` alone does not grant these actions. Request-free, user-free admin contexts are trusted background work (such as auto-cancel); Shop API contexts never get this exception.
- Cancelling a placed order needs a valid reason code (the order's `cancelReason` field), and `other` needs a note. Our admin's cancel sets it; on Vendure's Dashboard, set the fields first. Settled payments block cancellation on both API paths until refund recording is implemented. Vendure's cancellation mutation is checked before it changes lines, in a transaction with an order-row lock; error results roll back its changes.
- A direct state change to `Cancelled` cannot leave live order quantities behind. Use `cancelBdOrder` or Vendure's `cancelOrder`, which cancel the lines and release stock allocation together.
- Shipped orders can't be cancelled, only returned.
- New orders can't be packed or shipped without confirmation (except prepaid, with the setting above).
- A payment settled after confirmation (for example COD collected on delivery, phase 08) doesn't move the order back to New: Vendure tries `Confirmed` → `PaymentSettled`, the guard refuses it, and the payment is still settled.

Order editing (phase 05) will add `Confirmed`/`Packed` ↔ `Modifying` with a new row here.

## Return, stock and payment contract (2026-10-21 review)

These are the rules for order editing and the item-level returns/payment implementation. They do not change the roadmap's phase order.

### Current boundary

`markBdOrderReturned` records a delivery outcome and an optional note. It does **not** update `returnedQuantity`, restock items, create a refund, settle a payment or recalculate the order. The merchant admin explains this before the action and on returned orders, and does not show a collection instruction on returned/cancelled orders. The existing `returnedQuantity` field is reserved for item-level return records; zero currently does not prove that nothing came back.

`PartiallyDelivered → Returned` means the remaining parcel came back; it does not mean previously delivered items were returned. Keep fulfillment history and original line quantities/totals. A return status is never evidence that money was refunded or goods became saleable.

The basic item-level return flow below must be implemented and tested before relying on this workflow for a live merchant's inventory or money. Until then, the status-only action is an operational note, not a completed return settlement.

### Inventory rules

- Allocate stock at placement, release the allocation on cancellation, and record the sale/stock deduction through fulfillment. Do not deduct stock a second time on confirmation or delivery.
- Record each returned line's quantity explicitly against its shipment. Keep delivered, cancelled and returned quantities separately; reject quantities above what was shipped and not already returned.
- Receiving a return defaults to **awaiting inspection**, with no increase in saleable stock. Staff choose **restock** or **damaged** per item after inspection. Only restock creates a positive saleable-stock movement.
- Every return/restock operation has a stable operation ID and a history entry with actor, time, quantities and disposition. Retries and repeated courier callbacks must not apply stock movements twice.
- Returns after completed delivery use the same item records; do not reopen a delivered order merely to force its state through the current state machine.

### Money rules

- Keep four separate facts: original order value, customer payments actually settled, refunds actually settled, and courier remittances. A courier delivery notification is not proof of a payout to the merchant.
- An authorized COD payment is an expectation of collection, not money received. A typed TrxID is pending verification, not a settled payment.
- Calculate the net customer payment as settled receipts minus settled refunds. Pending or failed refunds never count as paid back. Preserve the original payment/refund records.
- Before shipment, edits recalculate line totals, discounts, shipping and the remaining collectible amount together. An increase on a prepaid order creates an additional amount due; a decrease creates a refund obligation, never an invented settled refund.
- For a partial return, refund only the affected quantities using their actual discounted/tax-inclusive amounts. Shipping/return fees need an explicit, recorded merchant decision. Never refund the full order simply because its summary status is `Returned`.
- A refund record must include amount, method/reference, state and acting staff. A physical return can be received while its refund remains pending; show that obligation until settled.
- A changed COD amount must be reconciled with an existing courier booking before dispatch. Order editing must not silently leave the courier collecting the old amount.

### Required regression cases when these flows are added

One of three units returned; mixed restock/damaged quantities; duplicate return requests; concurrent staff actions; partial advance followed by an edit or return; pending/failed refund; delivery before courier remittance; and cancellation releasing allocation exactly once. Each test checks quantities, stock movements, payment/refund amounts and history, not only the order status.

## Home metric

**Order value today / আজকের অর্ডারের মূল্য** is the total (including delivery charges) of orders placed in the selected Dhaka day, excluding cancelled orders. Undelivered and returned orders remain in this placed-order metric. It is not delivered revenue, money received or courier remittance. `todayOrderValue` is the Admin API field; `todaySales` remains a deprecated compatibility alias with the same `ReadSalesFigures` permission check.

## Why

- Vendure's order process is built to be extended this way, so we stay on upstream releases.
- One table in `packages/shared` drives both the server guard and the admin's buttons, so the admin never offers an action the server refuses.
- Refusing by default (anything not listed) is safer than trying to remove Vendure's default transitions one by one.
