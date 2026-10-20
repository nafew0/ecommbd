import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import { assertSafeUrl, createGuardedLookup, isPublicAddress, SsrfBlockedError } from './ssrf';

describe('isPublicAddress', () => {
    it.each([['8.8.8.8'], ['103.4.145.1'], ['2606:4700:4700::1111'], ['::ffff:8.8.8.8']])(
        'allows %s',
        address => {
            expect(isPublicAddress(address)).toBe(true);
        },
    );

    it.each([
        ['127.0.0.1'],
        ['10.0.0.1'],
        ['172.16.0.1'],
        ['192.168.1.1'],
        ['169.254.169.254'],
        ['100.64.0.1'],
        ['0.0.0.0'],
        ['0.1.2.3'],
        ['224.0.0.1'],
        ['255.255.255.255'],
        ['::1'],
        ['::'],
        ['fc00::1'],
        ['fe80::1'],
        ['::ffff:127.0.0.1'],
        ['not-an-ip'],
    ])('blocks %s', address => {
        expect(isPublicAddress(address)).toBe(false);
    });
});

describe('assertSafeUrl', () => {
    it('accepts public http(s) URLs', () => {
        expect(assertSafeUrl('https://example.com/image.jpg').hostname).toBe('example.com');
        expect(assertSafeUrl('http://8.8.8.8/x').port).toBe('');
        expect(assertSafeUrl('https://shop.example.com:8443/x').port).toBe('8443');
    });

    it.each([
        ['not a url', 'Invalid URL'],
        ['ftp://example.com/file', 'Protocol ftp: is not allowed'],
        ['file:///etc/passwd', 'Protocol file: is not allowed'],
        ['https://user:pass@example.com/', 'URLs with credentials are not allowed'],
        ['https://example.com:22/', 'Port 22 is not allowed'],
        ['http://localhost/', 'localhost is not allowed'],
        ['http://api.localhost/', 'localhost is not allowed'],
        ['http://127.0.0.1/', 'Address 127.0.0.1 is not public'],
        ['http://[::1]/', 'Address ::1 is not public'],
        ['http://169.254.169.254/latest/meta-data/', 'Address 169.254.169.254 is not public'],
    ])('blocks %s', (url, message) => {
        expect(() => assertSafeUrl(url)).toThrow(new SsrfBlockedError(message));
    });

    it('honours a custom port policy', () => {
        expect(assertSafeUrl('https://example.com:9443/', { allowedPorts: [9443] }).port).toBe('9443');
        expect(() => assertSafeUrl('https://example.com/', { allowedPorts: [9443] })).toThrow('Port 443');
    });
});

describe('createGuardedLookup', () => {
    const resolveTo =
        (...entries: LookupAddress[]) =>
        async () =>
            entries;

    const run = (
        lookup: ReturnType<typeof createGuardedLookup>,
        options: { family?: number | string; all?: boolean },
    ) =>
        new Promise<{ error: Error | null; address: unknown; family?: number }>(resolve => {
            lookup('shop.example', options, (error, address, family) => resolve({ error, address, family }));
        });

    it('returns a public address', async () => {
        const lookup = createGuardedLookup(resolveTo({ address: '93.184.215.14', family: 4 }));
        expect(await run(lookup, {})).toEqual({ error: null, address: '93.184.215.14', family: 4 });
    });

    it('returns all addresses when asked, filtered by family', async () => {
        const lookup = createGuardedLookup(
            resolveTo(
                { address: '93.184.215.14', family: 4 },
                { address: '2606:4700:4700::1111', family: 6 },
            ),
        );
        expect((await run(lookup, { all: true })).address).toHaveLength(2);
        expect((await run(lookup, { all: true, family: 'IPv6' })).address).toEqual([
            { address: '2606:4700:4700::1111', family: 6 },
        ]);
        expect((await run(lookup, { family: 4 })).address).toBe('93.184.215.14');
        expect((await run(lookup, { family: 'IPv4' })).address).toBe('93.184.215.14');
        expect((await run(lookup, { family: 6 })).address).toBe('2606:4700:4700::1111');
    });

    it('refuses hosts that resolve to any private address (DNS rebinding)', async () => {
        const lookup = createGuardedLookup(
            resolveTo({ address: '93.184.215.14', family: 4 }, { address: '10.0.0.5', family: 4 }),
        );
        const result = await run(lookup, {});
        expect(result.error).toBeInstanceOf(SsrfBlockedError);
        expect(result.error?.message).toBe('shop.example resolves to a non-public address');
    });

    it('refuses empty answers, missing families and resolver failures', async () => {
        expect((await run(createGuardedLookup(resolveTo()), {})).error?.message).toBe(
            'shop.example did not resolve',
        );
        expect(
            (
                await run(createGuardedLookup(resolveTo({ address: '93.184.215.14', family: 4 })), {
                    family: 6,
                })
            ).error?.message,
        ).toBe('shop.example has no IPv6 address');
        const failing = createGuardedLookup(async () => {
            throw new Error('ENOTFOUND');
        });
        expect((await run(failing, {})).error?.message).toBe('ENOTFOUND');
    });

    it('uses the system resolver by default', async () => {
        const lookup = createGuardedLookup();
        const result = await new Promise<Error | null>(resolve =>
            lookup('localhost', {}, error => resolve(error)),
        );
        expect(result).toBeInstanceOf(SsrfBlockedError);
    });
});
