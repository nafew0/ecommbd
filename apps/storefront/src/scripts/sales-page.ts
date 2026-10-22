import { enhanceCheckout } from './checkout';

/**
 * A sales page's script (roadmap phase 16), on top of a page that works without it:
 * - the order form behaves like the checkout (src/scripts/checkout.ts): choosing a pack, the
 *   variant, the add-on, the district or the payment updates the total; placing is sent with fetch;
 * - "Order this pack" buttons choose that pack in the form as they jump to it;
 * - the sticky order bar on phones steps aside while the form is on screen.
 */
export function enhanceSalesPage() {
    const form = document.querySelector<HTMLFormElement>('[data-sales-form]');
    if (form && !form.dataset.ready) {
        form.dataset.ready = '';
        enhanceCheckout(form, { refreshOn: '[data-pack], [data-bump], [data-variant]' });
    }

    document.addEventListener('click', event => {
        const link = (event.target as Element).closest<HTMLElement>('[data-pack-link]');
        const current = document.querySelector<HTMLFormElement>('[data-sales-form]');
        if (!link || !current) return;
        const pack = current.querySelector<HTMLInputElement>(
            `input[data-pack][value="${CSS.escape(link.dataset.packLink ?? '')}"]`,
        );
        if (pack && !pack.disabled && !pack.checked) {
            pack.checked = true;
            pack.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });

    const bar = document.querySelector<HTMLElement>('[data-sticky-order]');
    const target = document.getElementById('order');
    if (bar && target && 'IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) =>
            bar.classList.toggle('is-away', !!entry?.isIntersecting),
        ).observe(target);
    }
}
