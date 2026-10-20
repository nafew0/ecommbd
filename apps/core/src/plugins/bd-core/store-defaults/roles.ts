import { Permission } from '@vendure/core';
import { updateStoreSettingsPermission } from '../constants';

/**
 * The staff roles every store starts with. Assigning staff to them comes in phase 32; until then
 * only the owner account exists. The merchant admin hides what a role can't do, but the server is
 * what enforces it.
 *
 * Changing a set later: add a new store-defaults step (e.g. `roles-v2`) that updates existing
 * stores, so their own edits to roles are respected.
 */
export interface RoleDefinition {
    code: string;
    description: string;
    permissions: string[];
}

const P = Permission;
const UPDATE_STORE_SETTINGS = updateStoreSettingsPermission.Permission;

const crud = (...names: string[]) =>
    names.flatMap(name => ['Create', 'Read', 'Update', 'Delete'].map(op => op + name));

const catalog = crud('Catalog', 'Product', 'Collection', 'Facet', 'Asset', 'Tag');

const readOnlySettings = [
    P.ReadSettings,
    P.ReadChannel,
    P.ReadCountry,
    P.ReadZone,
    P.ReadTaxCategory,
    P.ReadTaxRate,
    P.ReadShippingMethod,
    P.ReadPaymentMethod,
    P.ReadStockLocation,
];

export const STORE_ROLES: readonly RoleDefinition[] = [
    {
        code: 'owner',
        description: 'Owner / মালিক: everything in the store, including staff and settings',
        permissions: [
            ...catalog,
            ...crud(
                'Order',
                'Customer',
                'CustomerGroup',
                'Promotion',
                'ShippingMethod',
                'PaymentMethod',
                'StockLocation',
                'Administrator',
                'TaxCategory',
                'TaxRate',
                'Zone',
                'Country',
                'Settings',
            ),
            P.ReadChannel,
            P.UpdateChannel,
            P.UpdateGlobalSettings,
            UPDATE_STORE_SETTINGS,
        ],
    },
    {
        code: 'manager',
        description:
            'Manager / ম্যানেজার: products, orders, customers, coupons and delivery; no staff or store settings',
        permissions: [
            ...catalog,
            ...crud('Customer', 'CustomerGroup', 'Promotion', 'StockLocation'),
            P.CreateOrder,
            P.ReadOrder,
            P.UpdateOrder,
            P.CreateShippingMethod,
            P.UpdateShippingMethod,
            P.ReadAdministrator,
            ...readOnlySettings,
        ],
    },
    {
        code: 'order-staff',
        description: 'Order staff / অর্ডার স্টাফ: confirm, edit and create orders (including phone orders)',
        permissions: [
            P.CreateOrder,
            P.ReadOrder,
            P.UpdateOrder,
            P.CreateCustomer,
            P.ReadCustomer,
            P.UpdateCustomer,
            P.ReadCatalog,
            P.ReadProduct,
            P.ReadAsset,
            P.ReadPromotion,
            ...readOnlySettings,
        ],
    },
    {
        code: 'packer',
        description: 'Packer / প্যাকার: see orders to pack and mark them packed',
        permissions: [P.ReadOrder, P.UpdateOrder, P.ReadCatalog, P.ReadProduct, P.ReadAsset, P.ReadSettings],
    },
    {
        code: 'marketing',
        description: 'Marketing / মার্কেটিং: coupons and tracking; read products, orders and customers',
        permissions: [
            ...crud('Promotion'),
            P.ReadCatalog,
            P.ReadProduct,
            P.ReadCollection,
            P.ReadFacet,
            P.ReadAsset,
            P.CreateAsset,
            P.ReadOrder,
            P.ReadCustomer,
            P.ReadCustomerGroup,
            P.ReadSettings,
        ],
    },
];
