/**
 * A per-key circuit breaker (key = provider host). After `failureThreshold` failures in a row,
 * calls are refused for `cooldownMs`; then one trial call is let through. Success closes the
 * circuit; another failure opens it again. Used so a gateway or courier outage fails fast and
 * checkout can hide that option instead of hanging.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
    /** Default 5. */
    failureThreshold?: number;
    /** Default 30 seconds. */
    cooldownMs?: number;
    now?: () => number;
}

interface Entry {
    failures: number;
    openUntil: number;
    trialInFlight: boolean;
}

export class CircuitBreaker {
    private readonly entries = new Map<string, Entry>();
    private readonly failureThreshold: number;
    private readonly cooldownMs: number;
    private readonly now: () => number;

    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.cooldownMs = options.cooldownMs ?? 30_000;
        this.now = options.now ?? Date.now;
    }

    state(key: string): CircuitState {
        const entry = this.entries.get(key);
        if (!entry || entry.failures < this.failureThreshold) {
            return 'closed';
        }
        return this.now() < entry.openUntil ? 'open' : 'half-open';
    }

    /** Whether a call may go ahead now. In half-open state only one trial call is allowed. */
    tryAcquire(key: string): boolean {
        const state = this.state(key);
        if (state === 'closed') {
            return true;
        }
        const entry = this.entries.get(key) as Entry;
        if (state === 'half-open' && !entry.trialInFlight) {
            entry.trialInFlight = true;
            return true;
        }
        return false;
    }

    success(key: string): void {
        this.entries.delete(key);
    }

    failure(key: string): void {
        const entry = this.entries.get(key) ?? { failures: 0, openUntil: 0, trialInFlight: false };
        entry.failures += 1;
        entry.trialInFlight = false;
        if (entry.failures >= this.failureThreshold) {
            entry.openUntil = this.now() + this.cooldownMs;
        }
        this.entries.set(key, entry);
    }
}
