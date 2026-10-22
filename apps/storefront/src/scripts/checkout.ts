import { parseBdMobile } from '@ecommbd/shared/phone';

/**
 * The checkout page's script (roadmap phase 14), on top of a form that works without it:
 * - the district, thana, delivery and payment choices update the thanas and the total at once
 *   (the form's own "Update total" post, sent with fetch; only the changed parts are swapped);
 * - "Place order" is sent with fetch: success follows the server's redirect to the thank-you page;
 *   anything else swaps in the server's answer (errors next to their fields, the SMS code step);
 * - the same idempotency key goes with every retry, so a double tap or a retry on a slow
 *   connection never makes two orders; offline, nothing is lost and a message says so;
 * - the phone number shows its operator as it's typed, and the checkout is saved for staff once
 *   the number is valid (phase 11's incomplete orders).
 */

const PARTS = ['thana', 'delivery', 'payment', 'summary'];
/** Hidden fields the server fills in (a sales page's form starts with them empty, phase 16). */
const HIDDEN = ['expectedTotal', 'csrf', 'idempotencyKey', 'stamp'];
const CHANGES = '[data-district], [data-thana], [data-shipping], [data-payment]';

export function enhanceCheckout(form: HTMLFormElement, options: { refreshOn?: string } = {}): void {
    const changes = options.refreshOn ? `${CHANGES}, ${options.refreshOn}` : CHANGES;
    const status = form.querySelector<HTMLElement>('[data-status]');
    const offline = status?.dataset.offline ?? '';
    let refresh: AbortController | undefined;
    let placing = false;
    for (const button of form.querySelectorAll<HTMLElement>('[data-refresh]')) button.hidden = true;

    const say = (text: string) => {
        const current = form.querySelector<HTMLElement>('[data-status]');
        if (current) current.textContent = text;
    };

    async function send(data: FormData, signal?: AbortSignal): Promise<Document | null> {
        const response = await fetch(form.getAttribute('action') ?? location.pathname, {
            method: 'POST',
            body: data,
            headers: { accept: 'text/html' },
            signal,
        });
        // Placed (or nothing left to place): the server redirected to the thank-you or cart page.
        if (response.redirected) {
            location.assign(response.url);
            return null;
        }
        return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    /** Swaps in the parts the server re-rendered: thanas, delivery, payment, summary, total. */
    function swapParts(page: Document) {
        for (const name of PARTS) {
            const next = page.querySelector(`[data-part="${name}"]`);
            const current = form.querySelector(`[data-part="${name}"]`);
            if (next && current) current.replaceWith(next);
        }
        for (const name of HIDDEN) {
            const next = page.querySelector<HTMLInputElement>(`input[name="${name}"]`);
            const current = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
            if (next && current) current.value = next.value;
        }
        const label = page.querySelector('[data-place]')?.textContent;
        const button = form.querySelector('[data-place]');
        if (label && button) button.textContent = label;
    }

    async function update(changed: HTMLElement) {
        refresh?.abort();
        refresh = new AbortController();
        const data = new FormData(form);
        data.set('action', 'refresh');
        // A new district starts with no thana.
        if (changed.matches('[data-district]')) data.set('thanaId', '');
        try {
            const page = await send(data, refresh.signal);
            if (page) swapParts(page);
            say('');
        } catch (error) {
            if ((error as Error).name !== 'AbortError') say(offline);
        }
    }

    form.addEventListener('change', event => {
        const target = event.target as HTMLElement;
        if (target.matches(changes)) void update(target);
    });

    form.addEventListener('submit', event => {
        event.preventDefault();
        const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
        const data = new FormData(form);
        data.set('action', submitter?.name === 'action' ? submitter.value : 'place');
        if (data.get('action') === 'refresh') {
            void update(submitter ?? form);
            return;
        }
        if (placing) return;
        placing = true;
        const button = form.querySelector<HTMLButtonElement>('[data-place]');
        const label = button?.textContent ?? '';
        if (button) {
            button.disabled = true;
            button.textContent = button.dataset.placing ?? label;
        }
        say('');
        send(data)
            .then(page => {
                if (!page) return;
                const next = page.querySelector('[data-checkout-form]');
                if (next) {
                    form.replaceChildren(...next.childNodes);
                } else {
                    // Nothing left to order (it all sold out): show the page the server sent.
                    const main = page.querySelector('main');
                    if (main) document.querySelector('main')?.replaceWith(main);
                    return;
                }
                for (const hidden of form.querySelectorAll<HTMLElement>('[data-refresh]'))
                    hidden.hidden = true;
                const alert = form.querySelector<HTMLElement>('[data-form-alert]');
                const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"], [data-otp] input');
                (invalid ?? alert)?.focus();
                alert?.scrollIntoView({ block: 'center' });
            })
            .catch(() => {
                // Offline or a timeout: keep everything, keep the key, let the shopper try again.
                if (button) {
                    button.disabled = false;
                    button.textContent = label;
                }
                say(offline);
            })
            .finally(() => {
                placing = false;
            });
    });

    // The operator as the number is typed, and the checkout saved once the number is valid.
    let saved = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const phoneChanged = (input: HTMLInputElement) => {
        const hint = form.querySelector<HTMLElement>('#phone-operator');
        const phone = parseBdMobile(input.value);
        if (hint)
            hint.textContent = phone.ok
                ? (hint.dataset.operatorTemplate ?? '').replace('{operator}', phone.phone.operator)
                : '';
        if (!phone.ok || phone.phone.e164 === saved) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            saved = phone.phone.e164;
            const data = new FormData(form);
            data.set('action', 'progress');
            void fetch(form.getAttribute('action') ?? location.pathname, {
                method: 'POST',
                body: data,
            }).catch(() => {
                saved = '';
            });
        }, 800);
    };
    form.addEventListener('input', event => {
        const input = event.target as HTMLInputElement;
        // Bangla keyboards compose letters: check once a letter is finished.
        if (input.matches('[data-phone]') && !(event as InputEvent).isComposing) phoneChanged(input);
    });
    form.addEventListener('compositionend', event => {
        const input = event.target as HTMLInputElement;
        if (input.matches('[data-phone]')) phoneChanged(input);
    });
    window.addEventListener('offline', () => say(offline));
    window.addEventListener('online', () => say(''));
}
