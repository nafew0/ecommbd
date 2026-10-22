import { attachSlideshows } from './slideshow';
import { attachVideos } from './video';

/**
 * The page editor's preview (roadmap phase 15), loaded only on preview pages shown in the editor's
 * frame. It tells the editor which sections the page has and which one the merchant clicked,
 * outlines the selected section, redraws the page from the latest draft without a reload (the
 * scroll stays put), shows theme changes before they're saved, and keeps the page read-only.
 *
 * Messages are accepted only from the editor's origin and only from the parent window, and are
 * sent only to that origin.
 */

const EDITOR = document.body.dataset.editorOrigin || location.origin;
const THEME_ATTRIBUTES = [
    'data-theme',
    'data-font',
    'data-buttons',
    'data-header',
    'data-cards',
    'data-logo',
];

let selected: string | null = null;

function post(message: Record<string, unknown>) {
    window.parent.postMessage({ source: 'ecommbd-preview', ...message }, EDITOR);
}

function sections(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-section]')];
}

function announce() {
    post({ type: 'ready', sections: sections().map(section => section.dataset.section) });
}

function highlight(scroll: boolean) {
    for (const section of sections()) {
        const on = section.dataset.section === selected;
        section.classList.toggle('preview-selected', on);
        if (on && scroll) {
            const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
            section.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
        }
    }
}

/** Fetches this page again (the draft just saved) and swaps in its content. */
async function refresh() {
    let response: Response;
    try {
        response = await fetch(location.href, { cache: 'no-store', credentials: 'same-origin' });
    } catch {
        return;
    }
    if (!response.ok) return;
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (next.body.dataset.preview !== 'editor') {
        post({ type: 'expired' });
        return;
    }
    const main = document.querySelector('main');
    const fresh = next.querySelector('main');
    if (main && fresh) main.replaceWith(document.adoptNode(fresh));
    for (const name of THEME_ATTRIBUTES) {
        const value = next.documentElement.getAttribute(name);
        if (value) document.documentElement.setAttribute(name, value);
    }
    attachSlideshows();
    attachVideos();
    highlight(false);
    announce();
}

interface ThemeMessage {
    attributes?: Record<string, string>;
    variables?: Record<string, string>;
    announcement?: { enabled: boolean; text: string };
}

/** Theme changes from the theme screen, before they're saved: only known attributes and hex colours. */
function applyTheme(theme: ThemeMessage) {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.attributes ?? {})) {
        if (THEME_ATTRIBUTES.includes(name) && /^[a-z0-9-]{1,40}$/.test(value))
            root.setAttribute(name, value);
    }
    for (const [name, value] of Object.entries(theme.variables ?? {})) {
        if (/^--[a-z-]{1,30}$/.test(name) && /^#[0-9a-f]{6}$/i.test(value))
            root.style.setProperty(name, value);
    }
    const bar = document.querySelector<HTMLElement>('[data-announcement]');
    if (bar && theme.announcement) {
        bar.hidden = !theme.announcement.enabled || !theme.announcement.text;
        const text = bar.querySelector('p');
        if (text) text.textContent = theme.announcement.text;
    }
}

window.addEventListener('message', event => {
    if (event.origin !== EDITOR || event.source !== window.parent) return;
    const data = event.data as { source?: string; type?: string; uid?: string; url?: string } & ThemeMessage;
    if (data?.source !== 'ecommbd-editor') return;
    if (data.type === 'select') {
        selected = typeof data.uid === 'string' ? data.uid : null;
        highlight(true);
    } else if (data.type === 'refresh') {
        void refresh();
    } else if (data.type === 'theme') {
        applyTheme(data);
    } else if (data.type === 'token' && typeof data.url === 'string') {
        // A renewed token: same page, new address (only on this site).
        const url = new URL(data.url, location.href);
        if (url.origin === location.origin && url.pathname === location.pathname) {
            history.replaceState(null, '', url.pathname + url.search);
        }
    }
});

// Read-only: links and forms do nothing; a click picks the section it's in.
document.addEventListener(
    'click',
    event => {
        const target = event.target as Element;
        if (target.closest('a')) event.preventDefault();
        const section = target.closest<HTMLElement>('[data-section]');
        if (section) {
            selected = section.dataset.section ?? null;
            highlight(false);
            post({ type: 'select', uid: selected });
        }
    },
    true,
);
document.addEventListener('submit', event => event.preventDefault(), true);
document.addEventListener('mouseover', event => {
    const section = (event.target as Element).closest<HTMLElement>('[data-section]');
    for (const item of sections()) item.classList.toggle('preview-hover', item === section);
});

announce();
