import { animate } from 'motion/mini';

/**
 * The cart drawer (roadmap phase 14): "Add to cart" on a product page and the header's cart button
 * open a slide-out cart instead of leaving the page. Its contents are the storefront's
 * `/cart/drawer/` fragment; its buttons are the cart page's own forms, sent with fetch. Without
 * JavaScript the same forms go to the cart page.
 */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = [0.2, 0.7, 0.2, 1] as const;

interface DrawerParts {
    root: HTMLElement;
    panel: HTMLElement;
    body: HTMLElement;
    close: HTMLButtonElement;
}

let parts: DrawerParts | null = null;
let opener: HTMLElement | null = null;

/** The drawer's address: the cart page's, plus `drawer/` (`/en/cart/drawer/` on the English site). */
function drawerUrl(): string {
    const cartLink = document.querySelector<HTMLAnchorElement>('[data-cart-link]');
    return new URL('drawer/', cartLink?.href ?? `${location.origin}/cart/`).pathname;
}

function build(): DrawerParts {
    const link = document.querySelector<HTMLElement>('[data-cart-link]');
    const root = document.createElement('div');
    root.className = 'cart-drawer';
    root.hidden = true;
    root.innerHTML =
        '<div class="cart-drawer-backdrop" data-close></div>' +
        '<div class="cart-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title">' +
        '<div class="cart-drawer-head"><h2 id="cart-drawer-title"></h2>' +
        '<button type="button" class="icon-button" data-close></button></div>' +
        '<div class="cart-drawer-body"></div></div>';
    const panel = root.querySelector<HTMLElement>('.cart-drawer-panel')!;
    const close = root.querySelector<HTMLButtonElement>('button[data-close]')!;
    root.querySelector('h2')!.textContent = link?.dataset.cartTitle ?? '';
    close.textContent = '×';
    close.setAttribute('aria-label', link?.dataset.closeLabel ?? 'Close');
    document.body.append(root);
    root.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('[data-close]')) void closeCart();
    });
    root.addEventListener('keydown', event => {
        if (event.key === 'Escape') void closeCart();
        if (event.key === 'Tab') keepFocusInside(event, panel);
    });
    // Quantity and remove buttons inside the drawer.
    root.addEventListener('submit', event => {
        const form = event.target as HTMLFormElement;
        if (!form.matches('[data-cart-form]')) return;
        event.preventDefault();
        void send(formData(form, (event as SubmitEvent).submitter));
    });
    return { root, panel, body: root.querySelector<HTMLElement>('.cart-drawer-body')!, close };
}

function keepFocusInside(event: KeyboardEvent, panel: HTMLElement) {
    const focusable = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
    }
}

/** A form's data including the button that sent it (older browsers leave it out). */
function formData(form: HTMLFormElement, submitter: HTMLElement | null): FormData {
    const data = new FormData(form);
    if (submitter instanceof HTMLButtonElement && submitter.name) data.set(submitter.name, submitter.value);
    return data;
}

/** The header's item count, from the cart fragment. */
function updateCount(count: number) {
    const badge = document.querySelector<HTMLElement>('[data-cart-count]');
    if (!badge) return;
    badge.textContent = String(count);
    badge.hidden = count < 1;
}

function show(html: string) {
    const fragment = new DOMParser().parseFromString(html, 'text/html').body;
    parts!.body.replaceChildren(...fragment.childNodes);
    const cart = parts!.body.querySelector<HTMLElement>('[data-cart]');
    if (cart) updateCount(Number(cart.dataset.count ?? 0));
}

async function request(init?: RequestInit): Promise<boolean> {
    try {
        const response = await fetch(drawerUrl(), { headers: { accept: 'text/html' }, ...init });
        if (!response.ok) return false;
        show(await response.text());
        return true;
    } catch {
        return false;
    }
}

async function send(data: FormData) {
    parts!.body.setAttribute('aria-busy', 'true');
    await request({ method: 'POST', body: data });
    parts!.body.removeAttribute('aria-busy');
}

async function open() {
    parts ??= build();
    if (!parts.root.hidden) return;
    opener = document.activeElement as HTMLElement | null;
    parts.root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    parts.close.focus();
    if (!reducedMotion()) {
        animate(
            parts.panel,
            { transform: ['translateX(100%)', 'translateX(0)'] },
            { duration: 0.28, ease: EASE },
        );
    }
}

export async function closeCart() {
    if (!parts || parts.root.hidden) return;
    if (!reducedMotion()) {
        await animate(
            parts.panel,
            { transform: ['translateX(0)', 'translateX(100%)'] },
            { duration: 0.2, ease: EASE },
        );
    }
    parts.root.hidden = true;
    parts.panel.style.transform = '';
    document.documentElement.style.overflow = '';
    opener?.focus();
}

/** Opens the drawer with the current cart. Returns false if it couldn't load (the link then works normally). */
export async function openCart(): Promise<boolean> {
    parts ??= build();
    if (!(await request())) return false;
    await open();
    return true;
}

/**
 * The product page's form: "Add to cart" adds in place and opens the drawer; "Buy now" posts as
 * usual and lands on checkout. The price follows the chosen variation.
 */
export function enhanceBuyForm(form: HTMLFormElement) {
    const price = document.querySelector<HTMLElement>('.price-large .price-now');
    form.addEventListener('change', event => {
        const input = event.target as HTMLInputElement;
        if (input.name === 'variantId' && input.dataset.price && price)
            price.textContent = input.dataset.price;
    });
    form.addEventListener('submit', event => {
        const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value !== 'add' || form.dataset.plain) return;
        event.preventDefault();
        parts ??= build();
        submitter.disabled = true;
        void request({ method: 'POST', body: formData(form, submitter) }).then(async ok => {
            submitter.disabled = false;
            if (ok) return open();
            // Couldn't reach the shop this way: send the form the plain way.
            form.dataset.plain = 'yes';
            form.requestSubmit(submitter);
        });
    });
}
