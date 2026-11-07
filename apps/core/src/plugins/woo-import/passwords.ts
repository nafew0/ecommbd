import {
    BcryptPasswordHashingStrategy,
    Injector,
    NativeAuthenticationMethod,
    PasswordHashingStrategy,
    TransactionalConnection,
} from '@vendure/core';
import { decryptSecret, parseKeyring, Keyring } from '@ecommbd/shared';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { WooLegacyAuth } from './helper-entities';

const alphabet = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const md5 = (input: Buffer | string) => createHash('md5').update(input).digest();
const same = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Work factors we accept from an imported hash. WordPress itself writes phpass hashes with 2^13
 * rounds (`$P$B…`) and bcrypt at cost 10 (WordPress 6.8+); plugins sometimes raise them a little. Every login attempt on a legacy
 * account pays this cost on our server, so a hostile source can't hand us hashes that take
 * seconds each (phpass allows 2^30 rounds, bcrypt cost 31). Others need a password reset.
 */
const PHPASS_MAX_POWER = 16;
const BCRYPT = /^\$2[aby]\$(0[4-9]|1[0-3])\$[./A-Za-z0-9]{53}$/;

export function isSupportedWordPressHash(hash: unknown): hash is string {
    if (typeof hash !== 'string') return false;
    if (/^[a-f0-9]{32}$/i.test(hash)) return true;
    if (/^\$[PH]\$[./A-Za-z0-9]{31}$/.test(hash)) {
        const power = alphabet.indexOf(hash[3]);
        return power >= 7 && power <= PHPASS_MAX_POWER;
    }
    return BCRYPT.test(hash.startsWith('$wp') ? hash.slice(3) : hash);
}
/** WordPress portable phpass uses MD5 bytes, not hexadecimal strings, between rounds. */
export async function verifyWordPressPassword(password: string, hash: string): Promise<boolean> {
    if (Buffer.byteLength(password) > 4096 || !isSupportedWordPressHash(hash)) return false;
    if (/^[a-f0-9]{32}$/i.test(hash)) return same(md5(password).toString('hex'), hash.toLowerCase());
    if (/^\$(P|H)\$/.test(hash)) {
        if (hash.length !== 34) return false;
        const power = alphabet.indexOf(hash[3]);
        // WordPress defaults are 8/13. Refuse pathological imported work factors.
        if (power < 7 || power > PHPASS_MAX_POWER || !/^[./A-Za-z0-9]{8}$/.test(hash.slice(4, 12)))
            return false;
        let result = md5(Buffer.concat([Buffer.from(hash.slice(4, 12)), Buffer.from(password)]));
        for (let i = 0; i < 2 ** power; i++) result = md5(Buffer.concat([result, Buffer.from(password)]));
        let encoded = '';
        for (let i = 0; i < result.length; i += 3) {
            const remaining = Math.min(3, result.length - i);
            const n = result[i] + ((result[i + 1] ?? 0) << 8) + ((result[i + 2] ?? 0) << 16);
            for (let j = 0; j < Math.ceil((remaining * 8) / 6); j++)
                encoded += alphabet[(n >>> (j * 6)) & 63];
        }
        return same(hash, hash.slice(0, 12) + encoded);
    }
    let candidate = password;
    if (hash.startsWith('$wp')) {
        candidate = createHmac('sha384', 'wp-sha384').update(password).digest('base64');
        hash = hash.slice(3);
    }
    if (!BCRYPT.test(hash)) return false;
    // Vendure already depends on bcrypt. Its strategy accepts the standard 2b form.
    return new BcryptPasswordHashingStrategy().check(candidate, hash.replace(/^\$2y\$/, '$2b$'));
}

/** Reference hashes bind the legacy secret to one native account. Reset replaces the reference. */
export class WooPasswordHashingStrategy implements PasswordHashingStrategy {
    private native = new BcryptPasswordHashingStrategy();
    private connection: TransactionalConnection;
    private keys?: Keyring;
    constructor(keys?: string) {
        if (keys) this.keys = parseKeyring(keys);
    }
    async init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }
    hash(password: string) {
        return this.native.hash(password);
    }
    async check(password: string, hash: string) {
        if (!hash.startsWith('woo:')) return this.native.check(password, hash);
        if (!this.keys || !/^woo:[a-f0-9]{64}$/.test(hash)) return false;
        const repo = this.connection.rawConnection.getRepository(WooLegacyAuth);
        const legacy = await repo
            .createQueryBuilder('a')
            .addSelect('a.secret')
            .where('a.reference = :ref', { ref: hash.slice(4) })
            .getOne();
        if (!legacy || legacy.expiresAt <= new Date()) return false;
        const secret = decryptSecret(legacy.secret, this.keys, `woo-password:${legacy.customerId}`);
        if (!(await verifyWordPressPassword(password, secret))) return false;
        const upgraded = await this.native.hash(password);
        return this.connection.rawConnection.transaction(async manager => {
            const updated = await manager
                .getRepository(NativeAuthenticationMethod)
                .createQueryBuilder()
                .update()
                .set({ passwordHash: upgraded })
                .where('"passwordHash" = :hash', { hash })
                .execute();
            if (!updated.affected) return false; // Password reset / another first login won the race.
            await manager.getRepository(WooLegacyAuth).delete(legacy.id);
            return true;
        });
    }
}
