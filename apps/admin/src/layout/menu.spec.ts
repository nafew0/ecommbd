import { describe, expect, it } from 'vitest';
import { en } from '../messages/en';
import { MENU, visibleMenu } from './menu';

describe('menu', () => {
    it('shows only built screens: Home, Orders, Products, Customers, Sales pages, Online store and Settings', () => {
        const menu = visibleMenu(MENU, () => true);
        expect(menu.map(group => group.label)).toEqual([
            'home',
            'orders',
            'products',
            'customers',
            'salesPages',
            'onlineStore',
            'settings',
        ]);
        expect(menu[1]!.children!.map(child => child.to)).toEqual([
            '/orders',
            '/orders/confirm',
            '/orders/phone',
            '/orders/incomplete',
            '/orders/campaigns',
            '/orders/payments',
        ]);
        expect(menu[2]!.children!.map(child => child.to)).toEqual([
            '/products',
            '/products/categories',
            '/products/stock',
        ]);
        expect(menu[3]!.children!.map(child => child.to)).toEqual(['/customers', '/customers/blocked']);
        expect(menu[4]!.link!.to).toBe('/sales-pages');
        expect(menu[5]!.children!.map(child => child.to)).toEqual([
            '/store/theme',
            '/store/design/home',
            '/store/design/product',
            '/store/menus',
            '/store/pages',
            '/store/search',
        ]);
        expect(menu[6]!.children!.map(child => child.to)).toEqual([
            '/settings/store',
            '/settings/orders',
            '/settings/delivery',
            '/settings/payments',
            '/settings/sms',
            '/settings/fraud',
            '/settings/invoice',
        ]);
    });

    it('hides a screen the role may not open', () => {
        const menu = visibleMenu(
            MENU,
            permission =>
                ![
                    'ReadSettings',
                    'ReadCustomer',
                    'ReadOrder',
                    'ConfirmOrder',
                    'ManageContent',
                    'VerifyPayment',
                    'CreateManualOrder',
                    'ReadProduct',
                    'ReadCatalog',
                    'EditStorefront',
                ].includes(permission),
        );
        expect(menu.map(group => group.label)).toEqual(['home']);
        // A packer sees the orders, but not the confirmation queue.
        const packer = visibleMenu(MENU, permission => permission === 'ReadOrder');
        expect(packer.find(group => group.label === 'orders')!.children!.map(child => child.to)).toEqual([
            '/orders',
            '/orders/incomplete',
            '/orders/campaigns',
        ]);
    });

    it('lists every menu of the plan, with a label in the messages', () => {
        expect(MENU.map(group => group.label)).toEqual([
            'home',
            'dashboard',
            'orders',
            'products',
            'customers',
            'salesPages',
            'onlineStore',
            'marketing',
            'settings',
        ]);
        for (const group of MENU) {
            for (const item of [group.link, ...(group.children ?? [])].filter(Boolean)) {
                expect(en.nav[item!.label]).toBeTruthy();
            }
        }
    });
});
