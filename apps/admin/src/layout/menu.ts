import {
    Globe,
    House,
    LayoutDashboard,
    type LucideIcon,
    Megaphone,
    Package,
    PanelsTopLeft,
    Settings,
    ShoppingBag,
    Users,
    Wallet,
} from 'lucide-react';
import type { Messages } from '../messages/en';

type NavKey = keyof Messages['nav'];

/** Where a screen lives: the main sidebar, or one of the two areas that replace it. */
export type Area = 'main' | 'store' | 'settings';

interface LinkOptions {
    /** Used less than weekly: sits under the group's "More" row. Search still finds it. */
    more?: boolean;
    /** The heading it sits under in the Settings area. */
    section?: NavKey;
    /** A to-do screen: shows this count from the order stats when it is above zero. */
    count?: 'waitingConfirmation' | 'incompleteOpen' | 'paymentsToVerify' | 'unmappedAddresses';
}

export interface MenuLink extends LinkOptions {
    label: NavKey;
    to: string;
    /** Set to true by the phase that builds the screen (roadmap phase in `phase`). */
    ready: boolean;
    phase: string;
    /** Hidden when the role lacks this permission. The server enforces it either way. */
    permission?: string;
}

export interface MenuGroup {
    label: NavKey;
    icon: LucideIcon;
    /** Set on the two groups that open as their own area ("Online store", "Settings"). */
    area?: Exclude<Area, 'main'>;
    /** A group is either one link (`link`) or a list of `children`. */
    link?: MenuLink;
    children?: MenuLink[];
}

const link = (
    label: NavKey,
    to: string,
    phase: string,
    ready = false,
    permission?: string,
    options: LinkOptions = {},
): MenuLink => ({ label, to, phase, ready, permission, ...options });

const more = { more: true };

/**
 * The merchant admin's whole menu (docs/design/admin-design-guide.md, section 3). Each item
 * appears when the phase that builds it ships. "Phone order" is not here: it is the "Create order"
 * button on the order list, and an action in search (`ACTIONS`).
 */
export const MENU: MenuGroup[] = [
    { label: 'home', icon: House, link: link('home', '/', '02', true) },
    { label: 'dashboard', icon: LayoutDashboard, link: link('dashboard', '/dashboard', '63c') },
    {
        label: 'orders',
        icon: ShoppingBag,
        children: [
            link('allOrders', '/orders', '04', true, 'ReadOrder'),
            link('confirmOrders', '/orders/confirm', '04', true, 'ConfirmOrder', {
                count: 'waitingConfirmation',
            }),
            link('incompleteOrders', '/orders/incomplete', '11', true, 'ReadOrder', {
                count: 'incompleteOpen',
            }),
            link('verifyPayments', '/orders/payments', '08', true, 'VerifyPayment', {
                count: 'paymentsToVerify',
            }),
            link('paymentReviews', '/orders/payment-reviews', '18', true, 'ReadOrder', more),
            link('ordersByCampaign', '/orders/campaigns', '16', true, 'ReadOrder', more),
            link('unmappedAddresses', '/orders/unmapped-addresses', '19', true, 'BookCourier', {
                more: true,
                count: 'unmappedAddresses',
            }),
            link('wooOrders', '/orders/woocommerce', '21', true, 'ReadOrder', more),
        ],
    },
    {
        label: 'products',
        icon: Package,
        children: [
            link('allProducts', '/products', '05', true, 'ReadProduct'),
            link('categories', '/products/categories', '05', true, 'ReadCatalog'),
            link('stock', '/products/stock', '05', true, 'ReadProduct'),
            link('brands', '/products/brands', '55', true, 'ReadCatalog', more),
            link('purchases', '/products/purchases', '52', true, 'ReadPurchase', more),
            link('suppliers', '/products/suppliers', '52', true, 'ReadPurchase', more),
            link('branches', '/products/branches', '54', true, 'ReadBranch', more),
            link('transfers', '/products/transfers', '54', true, 'ReadBranch', more),
            link('reviews', '/products/reviews', '35', false, 'ReadProduct', more),
        ],
    },
    {
        label: 'customers',
        icon: Users,
        children: [
            link('customerList', '/customers', '03', true, 'ReadCustomer'),
            link('blockList', '/customers/blocked', '11', true, 'ReadCustomer'),
        ],
    },
    {
        label: 'accounts',
        icon: Wallet,
        children: [
            link('accountList', '/accounts', '53', true, 'ManageAccounts'),
            link('profitAndLoss', '/accounts/profit', '53', true, 'ManageAccounts'),
            link('expenses', '/accounts/expenses', '53', true, 'ManageAccounts', more),
            link('transactions', '/accounts/transactions', '53', true, 'ManageAccounts', more),
        ],
    },
    {
        label: 'salesPages',
        icon: PanelsTopLeft,
        link: link('landingPages', '/sales-pages', '16', true, 'EditStorefront'),
    },
    {
        label: 'marketing',
        icon: Megaphone,
        children: [
            link('tracking', '/marketing/tracking', '20', true, 'ReadSettings'),
            link('coupons', '/marketing/coupons', '35', false, 'ReadPromotion', more),
        ],
    },
    {
        label: 'onlineStore',
        icon: Globe,
        area: 'store',
        children: [
            link('theme', '/store/theme', '15', true, 'EditStorefront'),
            link('homePage', '/store/design/home', '15', true, 'EditStorefront'),
            // The announcement bar and header layout are in Theme, footer links in Menus.
            link('productPage', '/store/design/product', '15', true, 'EditStorefront'),
            link('menus', '/store/menus', '12', true, 'ManageContent'),
            link('pages', '/store/pages', '12', true, 'ManageContent'),
            link('search', '/store/search', '13', true, 'ManageContent'),
        ],
    },
    {
        label: 'settings',
        icon: Settings,
        area: 'settings',
        children: [
            link('store', '/settings/store', '02', true, 'ReadSettings', { section: 'secStore' }),
            link('staff', '/settings/staff', '32', false, 'ReadAdministrator', { section: 'secStore' }),
            link('productSettings', '/settings/products', '55', true, 'ReadCatalog', { section: 'secStore' }),
            link('orderSettings', '/settings/orders', '04', true, 'ReadSettings', { section: 'secOrders' }),
            link('cost', '/settings/cost', '51', true, 'ReadCost', { section: 'secOrders', more: true }),
            link('purchaseSettings', '/settings/purchases', '52', true, 'ReadPurchase', {
                section: 'secOrders',
                more: true,
            }),
            link('fraud', '/settings/fraud', '11', true, 'ReadSettings', { section: 'secOrders' }),
            link('invoice', '/settings/invoice', '06', true, 'ReadSettings', { section: 'secOrders' }),
            link('checkout', '/settings/checkout', '14', false, undefined, { section: 'secOrders' }),
            link('delivery', '/settings/delivery', '07', true, 'ReadSettings', { section: 'secDelivery' }),
            link('branchSettings', '/settings/branches', '54', true, 'ReadBranch', {
                section: 'secDelivery',
                more: true,
            }),
            link('couriers', '/settings/couriers', '19', true, 'ReadSettings', { section: 'secDelivery' }),
            link('payments', '/settings/payments', '08', true, 'ReadSettings', { section: 'secPayments' }),
            link('onlinePayments', '/settings/online-payments', '18', true, 'ReadSettings', {
                section: 'secPayments',
            }),
            link('accountSettings', '/settings/accounts', '53', true, 'ManageAccounts', {
                section: 'secMoney',
                more: true,
            }),
            link('sms', '/settings/sms', '10', true, 'ReadSettings', { section: 'secMessages' }),
            link('migration', '/settings/woocommerce', '21', true, 'RunMigration', {
                section: 'secMovingIn',
            }),
        ],
    },
];

/** Things to do that search offers beside the screens. */
export const ACTIONS: Array<{
    label: 'createOrder' | 'addProduct' | 'addSalesPage';
    to: string;
    permission: string;
}> = [
    { label: 'createOrder', to: '/orders/phone', permission: 'CreateManualOrder' },
    { label: 'addProduct', to: '/products/new', permission: 'CreateProduct' },
    { label: 'addSalesPage', to: '/sales-pages', permission: 'EditStorefront' },
];

/** Which sidebar a path shows. The full-screen editors under /store have no sidebar at all. */
export function areaOf(pathname: string): Area {
    if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
    if (pathname === '/store' || pathname.startsWith('/store/')) return 'store';
    return 'main';
}

/**
 * The link of a group that marks the current page. The closest wins: /orders/woocommerce marks
 * only "WooCommerce orders", while an order's own page (/orders/123) still marks "All orders".
 */
export function activeLink(group: MenuGroup, pathname: string): MenuLink | undefined {
    const within = (to: string) => pathname === to || pathname.startsWith(`${to}/`);
    if (group.link)
        return (group.link.to === '/' ? pathname === '/' : within(group.link.to)) ? group.link : undefined;
    return (group.children ?? [])
        .filter(item => within(item.to))
        .sort((a, b) => b.to.length - a.to.length)[0];
}

/** The menu this person sees: built screens their role may open. Empty groups disappear. */
export function visibleMenu(menu: readonly MenuGroup[], can: (permission: string) => boolean): MenuGroup[] {
    const allowed = (item: MenuLink) => item.ready && (!item.permission || can(item.permission));
    return menu.flatMap(group => {
        if (group.link) {
            return allowed(group.link) ? [group] : [];
        }
        const children = (group.children ?? []).filter(allowed);
        return children.length ? [{ ...group, children }] : [];
    });
}
