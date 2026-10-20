import type { IncomingMessage, ServerResponse } from 'node:http';
import { LogLevel } from '@vendure/core';
import { describe, expect, it } from 'vitest';
import { JsonLogger } from '../../src/logging/json-logger';
import { getRequestId, requestIdMiddleware, runWithRequestId } from '../../src/logging/request-context';

function captureLogs(level = LogLevel.Info) {
    const lines: Array<Record<string, string>> = [];
    const logger = new JsonLogger({
        level,
        storeId: 's42',
        now: () => new Date('2026-10-20T10:00:00Z'),
        write: line => lines.push(JSON.parse(line) as Record<string, string>),
    });
    return { logger, lines };
}

describe('JSON logs', () => {
    it('writes one JSON line per entry, with the store ID', () => {
        const { logger, lines } = captureLogs();
        logger.info('Order placed', 'BdOrders');
        expect(lines).toEqual([
            {
                time: '2026-10-20T10:00:00.000Z',
                level: 'info',
                context: 'BdOrders',
                msg: 'Order placed',
                storeId: 's42',
            },
        ]);
    });

    it('masks phone numbers and emails', () => {
        const { logger, lines } = captureLogs();
        logger.error('SMS to 01712345678 failed for rahim@example.com');
        expect(lines[0]?.msg).toBe('SMS to 01******678 failed for r***@example.com');
    });

    it('skips entries below the log level', () => {
        const { logger, lines } = captureLogs(LogLevel.Warn);
        logger.info('hidden');
        logger.warn('shown');
        expect(lines.map(line => line.msg)).toEqual(['shown']);
    });

    it('adds the request ID while handling a request', () => {
        const { logger, lines } = captureLogs();
        runWithRequestId('req-1234567890', () => logger.info('inside'));
        expect(lines[0]?.requestId).toBe('req-1234567890');
    });
});

describe('request IDs', () => {
    function handle(incoming?: string) {
        const sent: Record<string, string> = {};
        const request = {
            headers: incoming ? { 'x-request-id': incoming } : {},
        } as unknown as IncomingMessage;
        const response = {
            setHeader: (name: string, value: string) => (sent[name] = value),
        } as unknown as ServerResponse;
        let seen: string | undefined;
        requestIdMiddleware(request, response, () => (seen = getRequestId()));
        return { sent: sent['x-request-id'], seen };
    }

    it('keeps a valid ID sent by Nginx or the caller', () => {
        expect(handle('nginx-abc123def456')).toEqual({
            sent: 'nginx-abc123def456',
            seen: 'nginx-abc123def456',
        });
    });

    it('creates a new ID when none is sent, or the one sent is unsafe', () => {
        expect(handle().sent).toMatch(/^[0-9a-f-]{36}$/);
        expect(handle('bad id\ninjected').sent).toMatch(/^[0-9a-f-]{36}$/);
    });
});
