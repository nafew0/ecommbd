import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { minor, catalogPrice, recordPhone, digest } from '../../src/plugins/woo-import/helpers';
import { mapWooAddress } from '../../src/plugins/woo-import/import-mapper.service';
import { verifyWordPressPassword } from '../../src/plugins/woo-import/passwords';
import { migrationPath, safeMigrationTarget } from '../../src/plugins/woo-import/urls';
import { chunkSignature } from '../../src/plugins/woo-import/helper.service';

describe('WooCommerce migration boundaries', () => {
    it('verifies real WordPress phpass output for P and H prefixes', async () => {
        const reference = path.join(__dirname, '../fixtures/woo/class-phpass.php');
        const password = 'Synthetic-চা-password';
        const hash = execFileSync(
            'php',
            [
                '-r',
                'require $argv[1];$h=new PasswordHash(8,true);echo $h->HashPassword($argv[2]);',
                reference,
                password,
            ],
            { encoding: 'utf8' },
        );
        expect(await verifyWordPressPassword(password, hash)).toBe(true);
        expect(await verifyWordPressPassword(password, hash.replace('$P$', '$H$'))).toBe(true);
        expect(await verifyWordPressPassword('wrong', hash)).toBe(false);
    });
    it('preserves exact historical totals and refuses unsupported catalog precision', () => {
        expect(digest([{ a: 1, b: 2 }])).toBe(digest([{ b: 2, a: 1 }]));
        expect(minor('99,999.25')).toBe('9999925');
        expect(minor('-0.25')).toBe('-25');
        expect(() => catalogPrice('1500.25')).toThrow();
        expect(catalogPrice('1,500.00')).toBe(150000);
        expect(() => minor('9'.repeat(1000))).toThrow();
        expect(() => minor('1.123')).toThrow();
    });
    it('maps Woo ISO codes by district name instead of treating them as BBS IDs', () => {
        expect(mapWooAddress({ state: 'BD-13', city: 'Dhanmondi' }).province).toBe('Dhaka');
        expect(mapWooAddress({ state: 'BD-30', city: 'Unknown' }).province).toBe('Kushtia');
        expect(mapWooAddress({ state: 'BD-30', city: 'Unknown' }).resolved).toBe(false);
        expect(recordPhone({ billing: { phone: '' }, shipping: { phone: '01712345678' } })).toBe(
            '+8801712345678',
        );
    });
    it('normalizes encoded Bangla, trailing slash and selector URLs without permitting redirects off-site', () => {
        expect(migrationPath('/ITEM/%E0%A6%B2%E0%A6%BE%E0%A6%B2?utm_source=x')).toBe(
            '/item/%E0%A6%B2%E0%A6%BE%E0%A6%B2/',
        );
        expect(migrationPath('/?p=12&utm_source=x')).toBe('/?p=12');
        for (const path of ['//evil.test/', 'https://evil.test/', '/%2f%2fevil/', '/x%0a/'])
            expect(() => migrationPath(path)).toThrow();
        expect(() => safeMigrationTarget('/admin/')).toThrow();
    });
    it('signs a UTF-8 payload string consistently with PHP, binding sequence and nonce', () => {
        const body = {
            sequence: 2,
            kind: 'products',
            payload: JSON.stringify({ records: [{ id: 1, name: 'লাল / shirt' }] }),
        };
        const values = { token: 'test-token', time: '1792610000', nonce: 'ab'.repeat(16), body };
        const php =
            '$v=json_decode($argv[1],true);$b=$v["body"];echo hash_hmac("sha256",$v["time"]."\\n".$v["nonce"]."\\n".$b["sequence"]."\\n".$b["kind"]."\\n".$b["payload"],$v["token"]);';
        const expected = execFileSync('php', ['-r', php, JSON.stringify(values)], { encoding: 'utf8' });
        expect(chunkSignature(values.token, values.time, values.nonce, body)).toBe(expected);
        expect(chunkSignature(values.token, values.time, values.nonce, { ...body, sequence: 3 })).not.toBe(
            expected,
        );
    });
    it('verifies PHP-generated WordPress bcrypt, plain bcrypt and MD5, with wrong/unsupported cases', async () => {
        const php =
            '$p=$argv[1];echo json_encode([md5($p),password_hash($p,PASSWORD_BCRYPT,["cost"=>10]),"$"."wp".password_hash(base64_encode(hash_hmac("sha384",$p,"wp-sha384",true)),PASSWORD_BCRYPT,["cost"=>10])]);';
        const password = 'Fixture-চা-password!';
        const hashes = JSON.parse(
            execFileSync('php', ['-r', php, password], { encoding: 'utf8' }),
        ) as string[];
        for (const hash of hashes) {
            expect(await verifyWordPressPassword(password, hash)).toBe(true);
            expect(await verifyWordPressPassword('wrong', hash)).toBe(false);
        }
        expect(await verifyWordPressPassword('x'.repeat(4097), hashes[0])).toBe(false);
        expect(await verifyWordPressPassword(password, '$argon2id$unknown')).toBe(false);
        expect(await verifyWordPressPassword(password, '$P$zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')).toBe(false);
    });
});
