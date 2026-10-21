import { animate } from 'motion/mini';

/**
 * Search suggestions (roadmap phase 13): products and categories as the shopper types, rendered by
 * the storefront at `/search/suggest/` as an HTML fragment. The search box becomes a combobox:
 * arrow keys move through the suggestions, Enter opens one, Escape closes the list. Loaded on the
 * box's first focus (Header.astro); without JavaScript the box is a plain search form.
 */

const MIN_CHARACTERS = 2;
const DEBOUNCE_MS = 200;
const CACHE_SIZE = 30;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function attachSuggestions(input: HTMLInputElement): void {
    const form = input.form;
    if (!form || input.dataset.suggest) return;
    input.dataset.suggest = 'on';

    // The suggestions page next to the results page, in the same language: `/en/search/suggest/`.
    const endpoint = new URL('suggest/', new URL(form.getAttribute('action') ?? '/search/', location.href));
    const panel = document.createElement('div');
    panel.className = 'suggest-panel';
    panel.id = 'search-suggest';
    panel.hidden = true;
    form.append(panel);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', panel.id);

    const cache = new Map<string, string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    let active = -1;

    const options = () => [...panel.querySelectorAll<HTMLAnchorElement>('[role="option"]')];

    function close() {
        panel.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }

    function setActive(index: number) {
        const list = options();
        if (!list.length) return;
        active = (index + list.length) % list.length;
        list.forEach((option, position) => {
            option.classList.toggle('is-active', position === active);
            option.setAttribute('aria-selected', String(position === active));
        });
        input.setAttribute('aria-activedescendant', list[active]!.id);
        list[active]!.scrollIntoView({ block: 'nearest' });
    }

    function show(html: string) {
        // Parsed, not assigned as HTML: scripts in the fragment would never run.
        const fragment = new DOMParser().parseFromString(html, 'text/html').body;
        if (!fragment.querySelector('[role="option"]')) {
            close();
            return;
        }
        panel.replaceChildren(...fragment.childNodes);
        options().forEach((option, index) => {
            option.id = `search-option-${index}`;
            option.tabIndex = -1;
        });
        const opening = panel.hidden;
        panel.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.removeAttribute('aria-activedescendant');
        active = -1;
        if (opening && !reducedMotion()) {
            animate(
                panel,
                { opacity: [0, 1], transform: ['translateY(-4px)', 'translateY(0)'] },
                { duration: 0.16, ease: 'easeOut' },
            );
        }
    }

    async function load(term: string) {
        const cached = cache.get(term);
        if (cached !== undefined) {
            show(cached);
            return;
        }
        request?.abort();
        request = new AbortController();
        try {
            const response = await fetch(`${endpoint.pathname}?q=${encodeURIComponent(term)}`, {
                signal: request.signal,
                headers: { accept: 'text/html' },
            });
            if (!response.ok) {
                close();
                return;
            }
            const html = await response.text();
            if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
            cache.set(term, html);
            // Only if the box still says the same thing.
            if (input.value.trim() === term) show(html);
        } catch {
            // Aborted by a newer request, or offline: the search form still works.
        }
    }

    function schedule() {
        clearTimeout(timer);
        const term = input.value.trim();
        if ([...term].length < MIN_CHARACTERS) {
            request?.abort();
            close();
            return;
        }
        timer = setTimeout(() => void load(term), DEBOUNCE_MS);
    }

    input.addEventListener('input', event => {
        // Bangla keyboards (Avro, Ridmik) compose letters: wait until a letter is finished.
        if ((event as InputEvent).isComposing) return;
        schedule();
    });
    input.addEventListener('compositionend', schedule);
    // Typed by the shopper (not the words a results page fills in): show suggestions again.
    const typed = () => !!input.value.trim() && input.value !== input.defaultValue;
    input.addEventListener('focus', () => {
        if (typed() && panel.hidden) schedule();
    });
    input.addEventListener('keydown', event => {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (panel.hidden) return;
            event.preventDefault();
            setActive(active + (event.key === 'ArrowDown' ? 1 : -1));
        } else if (event.key === 'Enter' && active >= 0 && !panel.hidden) {
            event.preventDefault();
            options()[active]?.click();
        } else if (event.key === 'Escape' && !panel.hidden) {
            event.preventDefault();
            close();
        }
    });
    form.addEventListener('focusout', event => {
        if (!form.contains(event.relatedTarget as Node | null)) close();
    });
    document.addEventListener('pointerdown', event => {
        if (!form.contains(event.target as Node)) close();
    });

    // Typed before this script arrived on a slow connection.
    if (typed()) schedule();
}
