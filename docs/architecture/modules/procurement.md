# Module: Procurement and Inventory

> Safezone by Techguard · Module documentation · v0.1 (13 Nov 2026)
> Phase: 5 · Owner: Backend · Apps: management-web, management-mobile (approvals)

## 1. Responsibility

Procurement lets an estate **buy goods and services and track what it owns and stocks**: suppliers, purchase requests, approval workflows, quotations, purchase orders, goods received, inventory items, stock movements and adjustments, asset register and assignment, consumables, and procurement expenditure reporting. It feeds payables in full accounting ([billing](billing.md), Phase 5).

## 2. Capabilities

1. Supplier register (company details, contacts, bank via provider reference, documents, categories, rating). Marketplace vendors can be linked as suppliers.
2. Purchase requests (PR): items, quantities, estimated cost, reason, required-by date, linked work order or budget line.
3. Approval workflows by amount bands (e.g. < ₦100k: Facility Manager; < ₦1m: Estate Manager; above: Estate Owner/committee).
4. Request for quotations (RFQ) to suppliers; quotation capture and comparison (at least N quotes above threshold).
5. Purchase orders (PO) from approved PR + selected quote; PO PDF sent to supplier.
6. Goods received notes (GRN): full/partial receipt, quality notes, photos.
7. Supplier invoices matched to PO and GRN (three-way match) → payable (Phase 5 accounting).
8. Inventory items: SKU, category, unit, reorder level, location (store), cost method (average).
9. Stock movements: receipt, issue (to work order, department), transfer, return, adjustment (with reason and approval), stock count.
10. Asset register: tagged assets (generators, pumps, CCTV, furniture), location, custodian, purchase cost, warranty, maintenance link, disposal.
11. Consumables tracking (diesel, cleaning supplies) with consumption reports.
12. Reports: spend by category/supplier/period, open POs, stock valuation, low stock, asset list.

## 3. Statuses

PR: `draft → submitted → approved | rejected → rfq → quoted → po_created → closed`.
PO: `draft → issued → partially_received → received → invoiced → closed`; `cancelled`.

## 4. Data model

| Table                    | Key columns                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suppliers`              | `id`, `estate_id`, `name`, `contacts`, `categories`, `vendor_id` (optional link), `status`, `rating`                                                                |
| `purchase_requests`      | `id`, `estate_id`, `number`, `requested_by`, `department`, `reason`, `required_by`, `estimated_total`, `work_order_id`, `budget_line_id`, `status`                  |
| `purchase_request_items` | `pr_id`, `description`, `inventory_item_id`, `qty`, `est_unit_cost`                                                                                                 |
| `approval_steps`         | `id`, `estate_id`, `subject_type`, `subject_id`, `step`, `approver_role`, `approver_id`, `decision`, `decided_at`, `comment` (shared engine with other approvals)   |
| `quotations`             | `id`, `estate_id`, `pr_id`, `supplier_id`, `total`, `valid_until`, `file_id`, `selected`                                                                            |
| `purchase_orders`        | `id`, `estate_id`, `number`, `pr_id`, `supplier_id`, `total`, `status`, `issued_at`                                                                                 |
| `goods_receipts`         | `id`, `estate_id`, `po_id`, `received_by`, `received_at`, `notes`, `photos`                                                                                         |
| `goods_receipt_items`    | `gr_id`, `po_item_ref`, `qty_received`, `qty_rejected`                                                                                                              |
| `inventory_items`        | `id`, `estate_id`, `sku`, `name`, `category`, `unit`, `reorder_level`, `avg_cost`                                                                                   |
| `stock_locations`        | `id`, `estate_id`, `name`, `space_id`                                                                                                                               |
| `stock_movements`        | `id`, `estate_id`, `item_id`, `location_id`, `type`, `qty`, `unit_cost`, `reference_type`, `reference_id`, `by`, `at`                                               |
| `assets`                 | `id`, `estate_id`, `tag`, `name`, `category`, `space_id`, `custodian_id`, `purchase_cost`, `purchased_on`, `warranty_until`, `status` (in_use, in_repair, disposed) |

## 5. Business rules

1. The requester cannot approve their own PR.
2. Above the quote threshold, at least 3 quotations (configurable) or a recorded justification.
3. A PO can only be created from an approved PR.
4. Stock on hand = sum of movements; negative stock not allowed (except with adjustment approval).
5. Adjustments and disposals need approval and a reason.
6. Three-way match tolerance (e.g. ±2%) before a supplier invoice becomes payable.

## 6. API (selection)

`/v1/estates/:estateId/suppliers`, `/purchase-requests` (+ `/submit`, `/approve`, `/reject`), `/quotations`, `/purchase-orders` (+ `/issue`, `/cancel`), `/goods-receipts`, `/inventory-items`, `/stock-movements`, `/stock-counts`, `/assets`, `/reports/procurement`, `/reports/inventory`.

## 7. Events

`procurement.pr.submitted`, `procurement.pr.approved`, `procurement.po.issued`, `procurement.goods.received`, `procurement.stock.low`, `procurement.asset.disposed`.

## 8. Acceptance criteria

- A PR above ₦1m (example band) requires the configured approvers in order before a PO can be created.
- Issuing stock to a work order reduces stock and records the cost on the work order.
- Low-stock alerts fire when on-hand drops below reorder level.
