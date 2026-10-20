import { describe, expect, it } from 'vitest';
import { en } from '../messages/en';
import { MENU, visibleMenu } from './menu';

describe('menu', () => {
    it('shows only built screens: Home and Settings → Store in phase 02', () => {
        const menu = visibleMenu(MENU, () => true);
        expect(menu.map(group => group.label)).toEqual(['home', 'settings']);
        expect(menu[1]!.children!.map(child => child.to)).toEqual(['/settings/store']);
    });

    it('hides a screen the role may not open', () => {
        const menu = visibleMenu(MENU, permission => permission !== 'ReadSettings');
        expect(menu.map(group => group.label)).toEqual(['home']);
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
