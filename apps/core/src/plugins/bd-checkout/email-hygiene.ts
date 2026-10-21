import { isPlaceholderEmail } from '@ecommbd/shared';

/** The part of Vendure's EmailEventHandler this needs. */
interface HandlesEmail {
    handle(...args: never[]): Promise<{ recipient: string } | undefined>;
}

type Handle = (...args: unknown[]) => Promise<{ recipient: string } | undefined>;

/**
 * Wraps email handlers so nothing is ever sent to a placeholder address (`…@phone.invalid`), whatever
 * the event. Phone-only customers get SMS instead (phase 10).
 */
export function skipPlaceholderRecipients<H extends HandlesEmail>(handlers: H[]): H[] {
    for (const handler of handlers) {
        const handle = handler.handle.bind(handler) as Handle;
        const wrapped: Handle = async (...args) => {
            const result = await handle(...args);
            return result && isPlaceholderEmail(result.recipient) ? undefined : result;
        };
        handler.handle = wrapped as H['handle'];
    }
    return handlers;
}
