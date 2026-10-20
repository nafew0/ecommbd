import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encryption for secrets stored in the database (gateway credentials, courier tokens, and so on).
 *
 * AES-256-GCM with a random 96-bit IV per value and an optional context string bound into the
 * auth tag (associated data), so a value encrypted for one purpose can't be decrypted as another.
 * Tokens carry their key version (`v2:…`), so old values keep working after a key rotation.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = /^v\d+$/;

export interface Keyring {
    /** Version used for new encryptions, e.g. `v2`. */
    current: string;
    keys: Record<string, Buffer>;
}

export class SecretDecryptionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecretDecryptionError';
    }
}

/** A new random key, base64-encoded, for `parseKeyring`. */
export function generateKey(): string {
    return randomBytes(KEY_BYTES).toString('base64');
}

/**
 * Parses `v1:<base64 key>,v2:<base64 key>`. The last entry is the current key.
 * Every key must be exactly 32 bytes; versions must be unique.
 */
export function parseKeyring(spec: string): Keyring {
    const keys: Record<string, Buffer> = {};
    let current: string | undefined;
    const entries = spec
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
    for (const [index, entry] of entries.entries()) {
        const separator = entry.indexOf(':');
        const version = separator > 0 ? entry.slice(0, separator) : '';
        // Never echo the entry itself: it may be a key pasted without its "v1:" prefix.
        if (!VERSION.test(version)) {
            throw new Error(`Key entry ${index + 1} is invalid: expected "v<number>:<base64 key>"`);
        }
        const key = Buffer.from(entry.slice(separator + 1), 'base64');
        if (keys[version]) {
            throw new Error(`Duplicate key version ${version}`);
        }
        if (key.length !== KEY_BYTES) {
            throw new Error(`Key ${version} must be ${KEY_BYTES} bytes, got ${key.length}`);
        }
        keys[version] = key;
        current = version;
    }
    if (!current) {
        throw new Error('The keyring is empty');
    }
    return { current, keys };
}

/** Encrypts `plaintext` with the current key. `context` must be the same when decrypting. */
export function encryptSecret(plaintext: string, keyring: Keyring, context = ''): string {
    const key = keyring.keys[keyring.current];
    if (!key) {
        throw new Error(`The current key ${keyring.current} is not in the keyring`);
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `${keyring.current}:${iv.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function splitToken(token: string): { version: string; iv: Buffer; payload: Buffer } {
    const parts = token.split(':');
    const [version, iv, payload] = parts;
    if (parts.length !== 3 || !version || !iv || !payload || !VERSION.test(version)) {
        throw new SecretDecryptionError('Malformed encrypted value');
    }
    return { version, iv: Buffer.from(iv, 'base64url'), payload: Buffer.from(payload, 'base64url') };
}

/** Decrypts a value from `encryptSecret`. Throws `SecretDecryptionError` on any problem. */
export function decryptSecret(token: string, keyring: Keyring, context = ''): string {
    const { version, iv, payload } = splitToken(token);
    const key = keyring.keys[version];
    if (!key) {
        throw new SecretDecryptionError(`No key for version ${version}`);
    }
    if (iv.length !== IV_BYTES || payload.length < TAG_BYTES) {
        throw new SecretDecryptionError('Malformed encrypted value');
    }
    try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
        const plain = Buffer.concat([
            decipher.update(payload.subarray(0, payload.length - TAG_BYTES)),
            decipher.final(),
        ]);
        return plain.toString('utf8');
    } catch {
        throw new SecretDecryptionError('Could not decrypt: wrong key, wrong context or tampered data');
    }
}

/** True when the value was encrypted with an older key and should be re-encrypted. */
export function needsRotation(token: string, keyring: Keyring): boolean {
    return splitToken(token).version !== keyring.current;
}

/** Re-encrypts a value with the current key (no-op if it already uses it). */
export function rotateSecret(token: string, keyring: Keyring, context = ''): string {
    if (!needsRotation(token, keyring)) {
        return token;
    }
    return encryptSecret(decryptSecret(token, keyring, context), keyring, context);
}
