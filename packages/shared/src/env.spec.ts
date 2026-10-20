import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { envBoolean, envList, envPort, EnvValidationError, loadEnvOrExit, parseEnv } from './env';

const schema = z.object({
    DB_HOST: z.string(),
    DB_PORT: envPort,
    SECRET: z.string().min(32, 'must be at least 32 characters'),
});

describe('parseEnv', () => {
    it('returns typed values', () => {
        expect(parseEnv(schema, { DB_HOST: 'localhost', DB_PORT: '5432', SECRET: 'x'.repeat(32) })).toEqual({
            DB_HOST: 'localhost',
            DB_PORT: 5432,
            SECRET: 'x'.repeat(32),
        });
    });

    it('lists every problem, treating empty values as missing', () => {
        try {
            parseEnv(schema, { DB_HOST: '  ', DB_PORT: 'abc', SECRET: 'short' });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(EnvValidationError);
            const problems = (error as EnvValidationError).problems;
            expect(problems[0]).toBe('DB_HOST: is required');
            expect(problems[1]).toMatch(/^DB_PORT: /);
            expect(problems[2]).toBe('SECRET: must be at least 32 characters');
            expect((error as Error).message).toContain('  - DB_HOST: is required');
        }
    });

    it('reports object-level rules without a variable name', () => {
        const refined = z
            .object({ A: z.string().optional() })
            .refine(value => value.A !== undefined, 'A or B is required');
        expect(() => parseEnv(refined, {})).toThrow('environment: A or B is required');
    });

    it('reads process.env by default', () => {
        process.env.SHARED_TEST_VALUE = 'hello';
        expect(parseEnv(z.object({ SHARED_TEST_VALUE: z.string() }))).toEqual({ SHARED_TEST_VALUE: 'hello' });
        delete process.env.SHARED_TEST_VALUE;
    });
});

describe('loadEnvOrExit', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the values when valid', () => {
        expect(loadEnvOrExit(z.object({ A: z.string() }), { source: { A: '1' } })).toEqual({ A: '1' });
    });

    it('reports the problems and exits with code 1', () => {
        const report = vi.fn();
        const exit = vi.fn((code: number) => {
            throw new Error(`exit ${code}`);
        }) as unknown as (code: number) => never;
        expect(() => loadEnvOrExit(schema, { source: {}, label: 'apps/core/.env', report, exit })).toThrow(
            'exit 1',
        );
        expect(report.mock.calls[0]?.[0]).toContain('DB_HOST: is required');
        expect(report.mock.calls[0]?.[0]).toContain('(check apps/core/.env)');
    });

    it('uses stderr and process.exit by default', () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
            throw new Error(`exit ${code}`);
        }) as never);
        expect(() => loadEnvOrExit(schema, { source: {} })).toThrow('exit 1');
        expect(String(write.mock.calls[0]?.[0])).toContain('Invalid environment configuration');
    });

    it('rethrows unexpected errors', () => {
        const broken = z.object({
            A: z.string().transform(() => {
                throw new Error('boom');
            }),
        });
        expect(() => loadEnvOrExit(broken, { source: { A: 'x' } })).toThrow('boom');
    });
});

describe('helpers', () => {
    it('parses ports, booleans and lists', () => {
        expect(envPort.parse('3000')).toBe(3000);
        expect(() => envPort.parse('70000')).toThrow();
        expect(envBoolean.parse('TRUE')).toBe(true);
        expect(envBoolean.parse('1')).toBe(true);
        expect(envBoolean.parse('0')).toBe(false);
        expect(() => envBoolean.parse('yes')).toThrow();
        expect(envList.parse(' https://a.com , ,https://b.com')).toEqual(['https://a.com', 'https://b.com']);
    });
});
