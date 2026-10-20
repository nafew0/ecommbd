import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
    it('opens after repeated failures, then lets one trial through after the cooldown', () => {
        let now = 0;
        const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
        expect(breaker.state('gw')).toBe('closed');
        expect(breaker.tryAcquire('gw')).toBe(true);

        breaker.failure('gw');
        expect(breaker.state('gw')).toBe('closed');
        breaker.failure('gw');
        expect(breaker.state('gw')).toBe('open');
        expect(breaker.tryAcquire('gw')).toBe(false);

        now = 1000;
        expect(breaker.state('gw')).toBe('half-open');
        expect(breaker.tryAcquire('gw')).toBe(true);
        expect(breaker.tryAcquire('gw')).toBe(false);

        breaker.failure('gw');
        expect(breaker.state('gw')).toBe('open');

        now = 2000;
        expect(breaker.tryAcquire('gw')).toBe(true);
        breaker.success('gw');
        expect(breaker.state('gw')).toBe('closed');
    });

    it('tracks each key separately and has sensible defaults', () => {
        const breaker = new CircuitBreaker();
        for (let i = 0; i < 5; i += 1) {
            breaker.failure('a');
        }
        expect(breaker.state('a')).toBe('open');
        expect(breaker.state('b')).toBe('closed');
    });
});
