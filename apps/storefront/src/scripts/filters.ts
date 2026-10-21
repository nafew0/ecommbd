import { animate } from 'motion/mini';
import { type ListingKind, listingQuery, parseListing } from '../lib/filters';

/**
 * Filters on category and search pages (roadmap phase 13), on top of the plain form that works
 * without JavaScript:
 * - the address is written in its one canonical spelling, so there is no redirect hop;
 * - on desktop a change applies at once; on phones the panel slides in and "Show results" applies,
 *   so several filters can be chosen in one go;
 * - Escape or the close button closes the panel and gives focus back.
 */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = [0.2, 0.7, 0.2, 1] as const;

export function enhanceFilters(root: HTMLElement): void {
    const form = root.querySelector<HTMLFormElement>('[data-filter-form]');
    const panel = root.querySelector<HTMLElement>('.filters');
    if (!form || !panel) return;
    const kind = (root.dataset.kind ?? 'category') as ListingKind;
    const desktop = matchMedia('(min-width: 990px)');
    const sort = document.querySelector<HTMLSelectElement>('select[form="filters-form"]');
    const toggle = root.querySelector<HTMLAnchorElement>('.filter-toggle');
    root.classList.add('js-filters');

    function apply() {
        const params = new URLSearchParams();
        for (const [name, value] of new FormData(form!)) {
            if (typeof value === 'string') params.append(name, value);
        }
        const target = `${form!.getAttribute('action') ?? location.pathname}${listingQuery(parseListing(params, kind), kind)}`;
        if (target !== `${location.pathname}${location.search}`) location.assign(target);
    }

    form.addEventListener('submit', event => {
        event.preventDefault();
        apply();
    });
    form.addEventListener('change', () => {
        if (desktop.matches) apply();
    });
    sort?.addEventListener('change', apply);

    function open(event: Event) {
        event.preventDefault();
        panel!.classList.add('is-open');
        document.documentElement.style.overflow = 'hidden';
        if (!reducedMotion()) {
            animate(
                panel!,
                { transform: ['translateX(100%)', 'translateX(0)'] },
                { duration: 0.28, ease: EASE },
            );
        }
        panel!.querySelector<HTMLElement>('.filters-close')?.focus();
    }

    async function close(event?: Event) {
        event?.preventDefault();
        if (!panel!.classList.contains('is-open')) return;
        if (!reducedMotion()) {
            await animate(
                panel!,
                { transform: ['translateX(0)', 'translateX(100%)'] },
                { duration: 0.2, ease: EASE },
            );
        }
        panel!.classList.remove('is-open');
        panel!.style.transform = '';
        document.documentElement.style.overflow = '';
        toggle?.focus();
    }

    toggle?.addEventListener('click', open);
    panel.querySelector('.filters-close')?.addEventListener('click', event => void close(event));
    panel.addEventListener('keydown', event => {
        if (event.key === 'Escape') void close(event);
    });
    // Back to desktop width with the panel open: just close it.
    desktop.addEventListener('change', () => {
        panel.classList.remove('is-open');
        document.documentElement.style.overflow = '';
    });
}
