import { describe, expect, it } from 'vitest';
import { en } from '../messages/en';
import { MENU, visibleMenu } from './menu';

describe('menu', () => {
    it('shows only built screens: Home, Orders (phase 04), Customers (03) and Settings (02, 04)', () => {
        const menu = visibleMenu(MENU, () => true);
        expect(menu.map(group => group.label)).toEqual(['home', 'orders', 'customers', 'settings']);
        expect(menu[1]!.children!.map(child => child.to)).toEqual(['/orders', '/orders/confirm']);
        expect(menu[2]!.children!.map(child => child.to)).toEqual(['/customers']);
        expect(menu[3]!.children!.map(child => child.to)).toEqual(['/settings/store', '/settings/orders']);
    });

    it('hides a screen the role may not open', () => {
        const menu = visibleMenu(
            MENU,
            permission => !['ReadSettings', 'ReadCustomer', 'ReadOrder', 'ConfirmOrder'].includes(permission),
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
