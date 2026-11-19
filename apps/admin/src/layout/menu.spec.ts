import { describe, expect, it } from 'vitest';
import { en } from '../messages/en';
import { bn } from '../messages/bn';
import { matches, searchIndex } from './command-search';
import { ACTIONS, activeLink, areaOf, MENU, visibleMenu } from './menu';

describe('menu', () => {
    it('shows only built screens: Home, Orders, Products, Customers, Sales pages, Online store and Settings', () => {
        const menu = visibleMenu(MENU, () => true);
        expect(menu.map(group => group.label)).toEqual([
            'home',
            'orders',
            'products',
            'customers',
            'accounts',
            'salesPages',
            'marketing',
            'onlineStore',
            'settings',
        ]);
        expect(menu[1]!.children!.map(child => child.to)).toEqual([
            '/orders',
            '/orders/confirm',
            '/orders/incomplete',
            '/orders/payments',
            '/orders/payment-reviews',
            '/orders/campaigns',
            '/orders/unmapped-addresses',
            '/orders/woocommerce',
        ]);
        // The first four are always shown; the rest sit under "More".
        expect(menu[1]!.children!.map(child => Boolean(child.more))).toEqual([
            false,
            false,
            false,
            false,
            true,
            true,
            true,
            true,
        ]);
        expect(menu[2]!.children!.map(child => child.to)).toEqual([
            '/products',
            '/products/categories',
            '/products/stock',
            '/products/purchases',
            '/products/suppliers',
            '/products/branches',
            '/products/transfers',
        ]);
        expect(menu[3]!.children!.map(child => child.to)).toEqual(['/customers', '/customers/blocked']);
        expect(menu[4]!.children!.map(child => child.to)).toEqual([
            '/accounts',
            '/accounts/profit',
            '/accounts/expenses',
            '/accounts/transactions',
        ]);
        expect(menu[4]!.children!.map(child => Boolean(child.more))).toEqual([false, false, true, true]);
        expect(menu[5]!.link!.to).toBe('/sales-pages');
        expect(menu[6]!.children!.map(child => child.to)).toEqual(['/marketing/tracking']);
        expect(menu[7]!.area).toBe('store');
        expect(menu[7]!.children!.map(child => child.to)).toEqual([
            '/store/theme',
            '/store/design/home',
            '/store/design/product',
            '/store/menus',
            '/store/pages',
            '/store/search',
        ]);
        expect(menu[8]!.area).toBe('settings');
        expect(menu[8]!.children!.map(child => child.to)).toEqual([
            '/settings/store',
            '/settings/orders',
            '/settings/cost',
            '/settings/purchases',
            '/settings/fraud',
            '/settings/invoice',
            '/settings/delivery',
            '/settings/branches',
            '/settings/couriers',
            '/settings/payments',
            '/settings/online-payments',
            '/settings/accounts',
            '/settings/sms',
            '/settings/woocommerce',
        ]);
        // Every settings screen sits under a heading.
        expect(menu[8]!.children!.every(child => child.section)).toBe(true);
    });

    it('hides a screen the role may not open', () => {
        const menu = visibleMenu(
            MENU,
            permission =>
                ![
                    'ReadSettings',
                    'RunMigration',
                    'ReadCustomer',
                    'ReadOrder',
                    'ConfirmOrder',
                    'ManageContent',
                    'VerifyPayment',
                    'CreateManualOrder',
                    'ReadProduct',
                    'ReadCatalog',
                    'EditStorefront',
                    'BookCourier',
                    'ReadCost',
                    'ReadPurchase',
                    'ManageAccounts',
                    'ReadBranch',
                ].includes(permission),
        );
        expect(menu.map(group => group.label)).toEqual(['home']);
        // A packer sees the orders, but not the confirmation queue.
        const packer = visibleMenu(MENU, permission => permission === 'ReadOrder');
        expect(packer.find(group => group.label === 'orders')!.children!.map(child => child.to)).toEqual([
            '/orders',
            '/orders/incomplete',
            '/orders/payment-reviews',
            '/orders/campaigns',
            '/orders/woocommerce',
        ]);
    });

    it('knows which sidebar a path shows, and which link marks the page', () => {
        expect(areaOf('/')).toBe('main');
        expect(areaOf('/orders/12')).toBe('main');
        expect(areaOf('/settings/delivery')).toBe('settings');
        expect(areaOf('/store/menus')).toBe('store');
        expect(areaOf('/storefront')).toBe('main');
        const orders = MENU.find(group => group.label === 'orders')!;
        expect(activeLink(orders, '/orders/123')!.to).toBe('/orders');
        expect(activeLink(orders, '/orders/woocommerce')!.to).toBe('/orders/woocommerce');
        expect(activeLink(orders, '/products')).toBeUndefined();
        expect(activeLink(MENU[0]!, '/orders')).toBeUndefined();
    });

    it('search finds every screen in both languages, and only what the role may open', () => {
        const all = searchIndex(
            visibleMenu(MENU, () => true),
            () => true,
            'bn',
            () => {},
            () => {},
        );
        const find = (query: string) =>
            all.filter(result => matches(result, query)).map(result => result.key);
        // A screen under "More" is still found, in English and in Bangla.
        expect(find('woocommerce orders')).toContain('/orders/woocommerce');
        expect(find(bn.nav.unmappedAddresses)).toEqual(['/orders/unmapped-addresses']);
        expect(find('delivery')).toContain('/settings/delivery');
        expect(find('create order')).toEqual(['action:createOrder']);
        expect(all.find(result => result.key === '/settings/delivery')!.label).toBe(bn.nav.delivery);
        expect(all.filter(result => result.kind === 'action')).toHaveLength(ACTIONS.length + 1);

        const packer = (permission: string) => permission === 'ReadOrder';
        const few = searchIndex(
            visibleMenu(MENU, packer),
            packer,
            'en',
            () => {},
            () => {},
        );
        expect(few.map(result => result.key)).toEqual([
            'action:tour',
            '/',
            '/orders',
            '/orders/incomplete',
            '/orders/payment-reviews',
            '/orders/campaigns',
            '/orders/woocommerce',
        ]);
    });

    it('lists every menu of the plan, with a label in the messages', () => {
        expect(MENU.map(group => group.label)).toEqual([
            'home',
            'dashboard',
            'orders',
            'products',
            'customers',
            'accounts',
            'salesPages',
            'marketing',
            'onlineStore',
            'settings',
        ]);
        for (const group of MENU) {
            for (const item of [group.link, ...(group.children ?? [])].filter(Boolean)) {
                expect(en.nav[item!.label]).toBeTruthy();
            }
        }
    });
});
