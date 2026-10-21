import { describe, expect, it } from 'vitest';
import { en } from '../messages/en';
import { MENU, visibleMenu } from './menu';

describe('menu', () => {
    it('shows only built screens: Home, Orders (04, 05, 08), Products (05), Customers (03) and Settings', () => {
        const menu = visibleMenu(MENU, () => true);
        expect(menu.map(group => group.label)).toEqual([
            'home',
            'orders',
            'products',
            'customers',
            'settings',
        ]);
        expect(menu[1]!.children!.map(child => child.to)).toEqual([
            '/orders',
            '/orders/confirm',
            '/orders/phone',
            '/orders/payments',
        ]);
        expect(menu[2]!.children!.map(child => child.to)).toEqual([
            '/products',
            '/products/categories',
            '/products/stock',
        ]);
        expect(menu[3]!.children!.map(child => child.to)).toEqual(['/customers']);
        expect(menu[4]!.children!.map(child => child.to)).toEqual([
            '/settings/store',
            '/settings/orders',
            '/settings/delivery',
            '/settings/payments',
            '/settings/sms',
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
                    'VerifyPayment',
                    'CreateManualOrder',
                    'ReadProduct',
                    'ReadCatalog',
                ].includes(permission),
        );
        expect(menu.map(group => group.label)).toEqual(['home']);
        // A packer sees the orders, but not the confirmation queue.
        const packer = visibleMenu(MENU, permission => permission === 'ReadOrder');
        expect(packer.find(group => group.label === 'orders')!.children!.map(child => child.to)).toEqual([
            '/orders',
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
