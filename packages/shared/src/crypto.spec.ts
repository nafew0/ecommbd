import { describe, expect, it } from 'vitest';
import {
    decryptSecret,
    encryptSecret,
    generateKey,
    needsRotation,
    parseKeyring,
    rotateSecret,
    SecretDecryptionError,
} from './crypto';

const key1 = generateKey();
const key2 = generateKey();

describe('parseKeyring', () => {
    it('uses the last entry as the current key', () => {
        const keyring = parseKeyring(` v1:${key1}, v2:${key2} `);
        expect(keyring.current).toBe('v2');
        expect(Object.keys(keyring.keys)).toEqual(['v1', 'v2']);
        expect(Buffer.from(key1, 'base64')).toHaveLength(32);
    });

    it.each([
        ['', 'The keyring is empty'],
        [' , ', 'The keyring is empty'],
        ['abc', 'Key entry 1 is invalid'],
        [key1, 'Key entry 1 is invalid'],
        [`v1:${key1},x2:${key2}`, 'Key entry 2 is invalid'],
        [`:${key1}`, 'Key entry 1 is invalid'],
        [`v1:${key1},v1:${key2}`, 'Duplicate key version v1'],
        ['v1:c2hvcnQ=', 'Key v1 must be 32 bytes, got 5'],
    ])('rejects %j', (spec, message) => {
        expect(() => parseKeyring(spec)).toThrow(message);
    });

    it('never puts key material in error messages', () => {
        try {
            parseKeyring(key1);
            expect.unreachable();
        } catch (error) {
            expect((error as Error).message).not.toContain(key1.slice(0, 8));
        }
    });
});

describe('encryptSecret / decryptSecret', () => {
    const keyring = parseKeyring(`v1:${key1}`);

    it('round-trips text, including Bangla', () => {
        const secret = 'বিকাশ-api-key-১২৩';
        const token = encryptSecret(secret, keyring, 'bkash');
        expect(token.startsWith('v1:')).toBe(true);
        expect(token).not.toContain(secret);
        expect(decryptSecret(token, keyring, 'bkash')).toBe(secret);
    });

    it('produces a different ciphertext every time', () => {
        expect(encryptSecret('same', keyring)).not.toBe(encryptSecret('same', keyring));
    });

    it('refuses the wrong context, the wrong key and tampered data', () => {
        const token = encryptSecret('secret', keyring, 'sslcommerz');
        expect(() => decryptSecret(token, keyring, 'bkash')).toThrow(SecretDecryptionError);
        expect(() => decryptSecret(token, parseKeyring(`v1:${key2}`), 'sslcommerz')).toThrow(
            SecretDecryptionError,
        );
        const [version, iv, payload] = token.split(':') as [string, string, string];
        const flipped = payload.startsWith('A') ? 'B' + payload.slice(1) : 'A' + payload.slice(1);
        expect(() => decryptSecret(`${version}:${iv}:${flipped}`, keyring, 'sslcommerz')).toThrow(
            SecretDecryptionError,
        );
    });

    it.each([['abc'], ['v1:x'], ['v1::y'], ['x1:a:b'], ['v1:a:b:c'], ['v1:AAAA:AAAA']])(
        'rejects the malformed value %j',
        token => {
            expect(() => decryptSecret(token, keyring)).toThrow('Malformed encrypted value');
        },
    );

    it('says which key is missing', () => {
        const token = encryptSecret('secret', parseKeyring(`v7:${key2}`));
        expect(() => decryptSecret(token, keyring)).toThrow('No key for version v7');
    });

    it('refuses to encrypt when the current key is missing', () => {
        expect(() => encryptSecret('x', { current: 'v9', keys: {} })).toThrow('The current key v9');
    });
});

describe('rotation', () => {
    it('re-encrypts values made with an older key', () => {
        const old = parseKeyring(`v1:${key1}`);
        const both = parseKeyring(`v1:${key1},v2:${key2}`);
        const token = encryptSecret('courier-token', old, 'steadfast');
        expect(needsRotation(token, both)).toBe(true);
        const rotated = rotateSecret(token, both, 'steadfast');
        expect(rotated.startsWith('v2:')).toBe(true);
        expect(needsRotation(rotated, both)).toBe(false);
        expect(decryptSecret(rotated, parseKeyring(`v2:${key2}`), 'steadfast')).toBe('courier-token');
        expect(rotateSecret(rotated, both, 'steadfast')).toBe(rotated);
    });
});
