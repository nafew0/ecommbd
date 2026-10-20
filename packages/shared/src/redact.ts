import { maskPhone, parseBdPhone } from './phone';

/**
 * Redaction for logs and error reports: no full phone numbers, emails, tokens, passwords or OTPs.
 */

const SENSITIVE_KEY =
    /pass(word)?|secret|token|authorization|cookie|otp|api[-_]?key|session|signature|private[-_]?key|credential/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Same shape as phone candidates: digits with separators, at least 8 digits. */
const PHONE_LIKE = /(?:\+|00)?\d(?:[\s\-().]*\d){7,}/g;
const MAX_DEPTH = 8;

export const REDACTED = '[REDACTED]';

/** `nafew@example.com` → `n***@example.com` */
export function maskEmail(email: string): string {
    const at = email.lastIndexOf('@');
    if (at <= 0) {
        return '***';
    }
    return `${email.charAt(0)}***${email.slice(at)}`;
}

/** Masks Bangladeshi phone numbers and email addresses inside free text. */
export function redactText(text: string): string {
    return text
        .replace(EMAIL, email => maskEmail(email))
        .replace(PHONE_LIKE, candidate => (parseBdPhone(candidate).ok ? maskPhone(candidate) : candidate));
}

/**
 * Deep-copies a value for logging: sensitive keys become `[REDACTED]`, strings are passed
 * through `redactText`, cycles and very deep nesting are cut off.
 */
export function redactObject(value: unknown): unknown {
    const seen = new WeakSet<object>();
    const walk = (current: unknown, depth: number): unknown => {
        if (typeof current === 'string') {
            return redactText(current);
        }
        if (current === null || typeof current !== 'object') {
            return current;
        }
        if (seen.has(current)) {
            return '[Circular]';
        }
        if (depth >= MAX_DEPTH) {
            return '[Truncated]';
        }
        if (current instanceof Date) {
            return current.toISOString();
        }
        seen.add(current);
        let result: unknown;
        if (Array.isArray(current)) {
            result = current.map(item => walk(item, depth + 1));
        } else {
            const copy: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(current)) {
                copy[key] = SENSITIVE_KEY.test(key) ? REDACTED : walk(item, depth + 1);
            }
            result = copy;
        }
        // Only true cycles are cut: the same object appearing twice side by side is fine.
        seen.delete(current);
        return result;
    };
    return walk(value, 0);
}

/** Header names whose values must never be logged. */
export function isSensitiveHeader(name: string): boolean {
    return SENSITIVE_KEY.test(name);
}
