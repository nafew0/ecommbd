import { Channel, Permission, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';
import { transitionPermissionError } from '../../src/plugins/bd-orders/order-policy.service';

function context(permissions: string[], apiType: 'admin' | 'shop' = 'admin') {
    return new RequestContext({
        apiType,
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
        channel: new Channel({ id: 1 }),
        session: {
            user: { id: 10, channelPermissions: [{ id: 1, permissions }] },
        } as never,
    });
}

describe('order action permissions beneath the resolvers', () => {
    it('does not treat UpdateOrder as permission to confirm, pack or cancel', () => {
        const ctx = context([Permission.UpdateOrder]);
        for (const state of ['Confirmed', 'Packed', 'Cancelled']) {
            expect(transitionPermissionError(ctx, state)).toBe('permission-required');
        }
    });

    it('allows the specific permission and the support superadmin', () => {
        for (const [state, permission] of [
            ['Confirmed', 'ConfirmOrder'],
            ['Packed', 'PackOrder'],
            ['Cancelled', 'CancelOrder'],
        ]) {
            expect(transitionPermissionError(context([permission]), state)).toBeUndefined();
            expect(transitionPermissionError(context([Permission.SuperAdmin]), state)).toBeUndefined();
        }
    });

    it('only exempts request-free, user-free admin work, never guest or authenticated shoppers', () => {
        expect(transitionPermissionError(RequestContext.empty(), 'Cancelled')).toBeUndefined();
        expect(
            transitionPermissionError(
                new RequestContext({
                    apiType: 'shop',
                    channel: new Channel({ id: 1 }),
                    isAuthorized: true,
                    authorizedAsOwnerOnly: true,
                }),
                'Confirmed',
            ),
        ).toBe('permission-required');
        expect(transitionPermissionError(context(['ConfirmOrder'], 'shop'), 'Confirmed')).toBe(
            'permission-required',
        );
        expect(
            transitionPermissionError(
                new RequestContext({
                    apiType: 'admin',
                    channel: new Channel({ id: 1 }),
                    req: {} as never,
                    isAuthorized: false,
                    authorizedAsOwnerOnly: false,
                }),
                'Cancelled',
            ),
        ).toBe('permission-required');
    });
});
