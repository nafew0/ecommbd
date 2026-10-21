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
} from 'lucide-react';
import type { Messages } from '../messages/en';

type NavKey = keyof Messages['nav'];

export interface MenuLink {
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
    /** A group is either one link (`link`) or a list of `children`. */
    link?: MenuLink;
    children?: MenuLink[];
}

const link = (label: NavKey, to: string, phase: string, ready = false, permission?: string): MenuLink => ({
    label,
    to,
    phase,
    ready,
    permission,
});

/**
 * The merchant admin's whole menu (docs/roadmap/m1-foundations.md, phase 02b). Each item appears
 * when the phase that builds it ships. No spin wheel.
 */
export const MENU: MenuGroup[] = [
    { label: 'home', icon: House, link: link('home', '/', '02', true) },
    { label: 'dashboard', icon: LayoutDashboard, link: link('dashboard', '/dashboard', '04, 33') },
    {
        label: 'orders',
        icon: ShoppingBag,
        children: [
            link('allOrders', '/orders', '04', true, 'ReadOrder'),
            link('confirmOrders', '/orders/confirm', '04', true, 'ConfirmOrder'),
            link('phoneOrder', '/orders/phone', '05', true, 'CreateManualOrder'),
            link('incompleteOrders', '/orders/incomplete', '11', true, 'ReadOrder'),
            link('verifyPayments', '/orders/payments', '08', true, 'VerifyPayment'),
        ],
    },
    {
        label: 'products',
        icon: Package,
        children: [
            link('allProducts', '/products', '05', true, 'ReadProduct'),
            link('categories', '/products/categories', '05', true, 'ReadCatalog'),
            link('reviews', '/products/reviews', '35', false, 'ReadProduct'),
            link('stock', '/products/stock', '05', true, 'ReadProduct'),
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
    { label: 'salesPages', icon: PanelsTopLeft, link: link('landingPages', '/sales-pages', '16') },
    {
        label: 'onlineStore',
        icon: Globe,
        children: [
            link('theme', '/store/theme', '15'),
            link('homePage', '/store/home', '15'),
            link('headerFooter', '/store/header-footer', '15'),
            link('menus', '/store/menus', '12', true, 'ManageContent'),
            link('pages', '/store/pages', '12', true, 'ManageContent'),
            link('search', '/store/search', '13', true, 'ManageContent'),
        ],
    },
    {
        label: 'marketing',
        icon: Megaphone,
        children: [
            link('coupons', '/marketing/coupons', '35', false, 'ReadPromotion'),
            link('tracking', '/marketing/tracking', '20, 36'),
        ],
    },
    {
        label: 'settings',
        icon: Settings,
        children: [
            link('store', '/settings/store', '02', true, 'ReadSettings'),
            link('orderSettings', '/settings/orders', '04', true, 'ReadSettings'),
            link('delivery', '/settings/delivery', '07', true, 'ReadSettings'),
            link('payments', '/settings/payments', '08', true, 'ReadSettings'),
            link('sms', '/settings/sms', '10', true, 'ReadSettings'),
            link('fraud', '/settings/fraud', '11', true, 'ReadSettings'),
            link('couriers', '/settings/couriers', '19'),
            link('checkout', '/settings/checkout', '14'),
            link('invoice', '/settings/invoice', '06', true, 'ReadSettings'),
            link('staff', '/settings/staff', '32', false, 'ReadAdministrator'),
        ],
    },
];

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
