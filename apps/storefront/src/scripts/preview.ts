import { attachCountdowns } from './countdown';
import { attachSlideshows } from './slideshow';
import { attachVideos } from './video';

/**
 * The page editor's preview (roadmap phase 15), loaded only on preview pages shown in the editor's
 * frame. It tells the editor which sections the page has and which one the merchant clicked,
 * outlines the selected section, redraws the page from the latest draft without a reload (the
 * scroll stays put), shows theme changes before they're saved, and keeps the page read-only.
 *
 * Since phase 58 it is also the canvas of a free section: a click picks the element under it, the
 * selected element gets an outline with its name and a small toolbar (move, duplicate, remove),
 * a double-click on a heading, a button or a badge changes its words in place, "Add section" and
 * "Add inside" ask the editor for something new, and a dragged element shows where it would land.
 * The page itself never changes here: every action is a message to the editor, which changes the
 * draft and asks for a redraw.
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
/** The node chosen inside the selected free section (phase 58), if any. */
let selectedNode: string | null = null;
/** Text being changed on the canvas: nothing redraws the page until it's finished. */
let editing: { element: HTMLElement; before: string } | null = null;
let refreshWaiting = false;
/** Something is being dragged: from the editor's list of elements, or a node on the canvas. */
let dragging = false;

const LABELS: Record<string, string> = JSON.parse(
    document.getElementById('preview-labels')?.dataset.labels ?? '{}',
);

function post(message: Record<string, unknown>) {
    window.parent.postMessage({ source: 'ecommbd-preview', ...message }, EDITOR);
}

function sections(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-section]')];
}

function announce() {
    post({ type: 'ready', sections: sections().map(section => section.dataset.section) });
}

const nodeOf = (target: EventTarget | null) =>
    (target as Element | null)?.closest<HTMLElement>('[data-node]') ?? null;
const sectionOf = (target: EventTarget | null) =>
    (target as Element | null)?.closest<HTMLElement>('[data-section]') ?? null;
const findNode = (uid: string | null) =>
    uid ? document.querySelector<HTMLElement>(`[data-node][data-u="${CSS.escape(uid)}"]`) : null;

// The canvas's own controls, drawn over the page: an outline with a name tag and a toolbar on the
// selected node, a lighter outline on the one under the pointer, "Add section" below a section,
// and a line where a dragged element would land.
const ICONS: Record<string, string> = {
    drag: 'M7 4.5h.5V5H7zM12.5 4.5h.5V5h-.5zM7 9.75h.5v.5H7zM12.5 9.75h.5v.5h-.5zM7 15h.5v.5H7zM12.5 15h.5v.5h-.5z',
    parent: 'M5.25 12.75V4.25h8.5M10.5 7.5l3.25-3.25L10.5 1M5.25 16.25h10.5',
    up: 'M10 15.75V4.25M5.25 9L10 4.25 14.75 9',
    down: 'M10 4.25v11.5M5.25 11L10 15.75 14.75 11',
    duplicate: 'M6.75 6.75h10.5v10.5H6.75zM13.25 3.75H2.75v10.5',
    remove: 'M3.75 5.75h12.5M7.75 5.75v-2h4.5v2M5.25 5.75l.75 10.5h8l.75-10.5M8.5 8.75v4.5M11.5 8.75v4.5',
};

function tool(action: string): string {
    const title = LABELS[action] ?? action;
    return `<button type="button" data-tool="${action}" title="${title}" aria-label="${title}"${
        action === 'drag' ? ' draggable="true"' : ''
    }><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="${ICONS[action]}"/></svg></button>`;
}

function make(className: string, html = ''): HTMLElement {
    const element = document.createElement('div');
    element.className = className;
    element.innerHTML = html;
    element.dataset.canvasUi = '';
    document.body.append(element);
    return element;
}

const frame = make(
    'canvas-frame',
    `<span class="canvas-tag"></span><span class="canvas-tools">${[
        'drag',
        'parent',
        'up',
        'down',
        'duplicate',
        'remove',
    ]
        .map(tool)
        .join('')}</span>`,
);
const hover = make('canvas-hover', '<span class="canvas-tag"></span>');
const adder = make('canvas-add', `<button type="button">${LABELS.addSection ?? '+'}</button>`);
const dropLine = make('canvas-drop');
let adderAfter: string | null = null;

/** Puts an overlay over an element (or hides it), in page coordinates. */
function place(overlay: HTMLElement, element: HTMLElement | null) {
    if (!element?.isConnected) {
        overlay.hidden = true;
        return;
    }
    const box = element.getBoundingClientRect();
    overlay.hidden = false;
    overlay.style.top = `${box.top + window.scrollY}px`;
    overlay.style.left = `${box.left + window.scrollX}px`;
    overlay.style.width = `${box.width}px`;
    overlay.style.height = `${box.height}px`;
    const tag = overlay.querySelector('.canvas-tag');
    if (tag) tag.textContent = element.dataset.nodeName ?? '';
    // Near the top of the page the tag and tools sit inside the outline instead of above it.
    overlay.classList.toggle('canvas-inside', box.top + window.scrollY < 28);
}

/**
 * Scrolls this page (and only this page) to an element. `scrollIntoView` would also scroll the
 * editor around the frame, which shows the page scaled down inside a clipped box.
 */
function scrollTo(element: HTMLElement, where: 'start' | 'center') {
    const box = element.getBoundingClientRect();
    const top =
        where === 'start'
            ? box.top + window.scrollY - 16
            : box.top + window.scrollY - Math.max(0, (window.innerHeight - box.height) / 2);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
}

function highlight(scroll: boolean) {
    for (const section of sections()) {
        const on = section.dataset.section === selected;
        // With a node chosen, the node carries the outline; its section steps back.
        section.classList.toggle('preview-selected', on && !selectedNode);
        if (on && scroll && !selectedNode) scrollTo(section, 'start');
    }
    const node = findNode(selectedNode);
    place(frame, node);
    if (node && scroll) {
        const box = node.getBoundingClientRect();
        if (box.top < 40 || box.bottom > window.innerHeight) scrollTo(node, 'center');
    }
}

/** Fetches this page again (the draft just saved) and swaps in its content. */
async function refresh() {
    if (editing) {
        refreshWaiting = true;
        return;
    }
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
    // The Design options' stylesheet (phase 16) changes with the sections.
    const style = document.querySelector('style[data-layout-css]');
    const freshStyle = next.querySelector('style[data-layout-css]');
    if (freshStyle) {
        if (style) style.replaceWith(document.adoptNode(freshStyle));
        else document.head.append(document.adoptNode(freshStyle));
    } else {
        style?.remove();
    }
    for (const name of THEME_ATTRIBUTES) {
        const value = next.documentElement.getAttribute(name);
        if (value) document.documentElement.setAttribute(name, value);
    }
    attachSlideshows();
    attachVideos();
    attachCountdowns();
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
    const data = event.data as {
        source?: string;
        type?: string;
        uid?: string;
        node?: string;
        url?: string;
        active?: boolean;
    } & ThemeMessage;
    if (data?.source !== 'ecommbd-editor') return;
    if (data.type === 'select') {
        selected = typeof data.uid === 'string' ? data.uid : null;
        selectedNode = typeof data.node === 'string' ? data.node : null;
        highlight(true);
    } else if (data.type === 'refresh') {
        void refresh();
    } else if (data.type === 'audit') {
        audit();
    } else if (data.type === 'drag') {
        dragging = data.active === true;
        if (!dragging) dropLine.hidden = true;
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

/**
 * What can only be seen on the drawn page (the checklist, phase 62), at the width it's shown now:
 * whether the page scrolls sideways and which parts stick out, and which buttons are too small
 * to tap (under 44 px either way). Each is named by the section and the element it's in.
 */
function audit() {
    const width = document.documentElement.clientWidth;
    const where = (element: Element) => ({
        uid: sectionOf(element)?.dataset.section ?? null,
        node: nodeOf(element)?.dataset.u ?? null,
    });
    const key = (item: { uid: string | null; node: string | null }) => `${item.uid}/${item.node}`;
    const unique = (items: Array<{ uid: string | null; node: string | null }>) =>
        [...new Map(items.filter(item => item.uid).map(item => [key(item), item])).values()].slice(0, 20);
    const scrolls = document.documentElement.scrollWidth > width + 1;
    const wide = scrolls
        ? [...document.querySelectorAll<HTMLElement>('main [data-node], main [data-section]')].filter(
              element => {
                  const box = element.getBoundingClientRect();
                  return box.width > 0 && (box.right > width + 1 || box.left < -1);
              },
          )
        : [];
    const small = [
        ...document.querySelectorAll<HTMLElement>('main [data-section] :is(.button, button, .text-link)'),
    ].filter(element => {
        if (element.closest('[data-canvas-ui], [data-add-inside]')) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
    });
    post({
        type: 'audit-result',
        width,
        scrolls,
        overflow: unique(wide.map(where)),
        small: unique(small.map(where)),
    });
}

/** Ends a text edit: the new words go to the editor, or the old ones come back. */
function finishEdit(keep: boolean) {
    if (!editing) return;
    const { element, before } = editing;
    editing = null;
    element.removeAttribute('contenteditable');
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    const node = nodeOf(element);
    if (keep && text !== before && node) {
        element.textContent = text;
        post({
            type: 'text',
            uid: sectionOf(node)?.dataset.section,
            node: node.dataset.u,
            field: element.dataset.edit,
            value: text,
        });
    } else {
        element.textContent = before;
    }
    if (refreshWaiting) {
        refreshWaiting = false;
        void refresh();
    }
}

// Read-only: links and forms do nothing. A click picks the node it's on (inside a free section),
// or the section; the toolbar and the "add" buttons tell the editor what to do.
document.addEventListener(
    'click',
    event => {
        const target = event.target as Element;
        if (editing?.element.contains(target)) return;
        if (target.closest('a')) event.preventDefault();
        const button = target.closest<HTMLElement>('[data-tool]');
        if (button) {
            const node = findNode(selectedNode);
            if (node && button.dataset.tool !== 'drag') {
                post({
                    type: 'node-action',
                    action: button.dataset.tool,
                    uid: sectionOf(node)?.dataset.section,
                    node: selectedNode,
                });
            }
            return;
        }
        if (target.closest('.canvas-add')) {
            post({ type: 'add-section', after: adderAfter });
            return;
        }
        const section = sectionOf(target);
        if (!section) return;
        const node = nodeOf(target);
        selected = section.dataset.section ?? null;
        selectedNode = node?.dataset.u ?? null;
        highlight(false);
        if (node && target.closest('[data-add-inside]')) {
            post({ type: 'add-inside', uid: selected, node: selectedNode });
            return;
        }
        post({ type: 'select', uid: selected, node: selectedNode });
    },
    true,
);
document.addEventListener('submit', event => event.preventDefault(), true);

// Double-click a heading, a button or a badge to change its words in place.
document.addEventListener('dblclick', event => {
    const element = (event.target as Element).closest<HTMLElement>('[data-edit]');
    if (!element || editing) return;
    event.preventDefault();
    editing = { element, before: element.textContent ?? '' };
    element.setAttribute('contenteditable', 'plaintext-only');
    // Browsers without plain-text editing fall back to ordinary editing; only the text is kept.
    if (element.contentEditable !== 'plaintext-only') element.setAttribute('contenteditable', 'true');
    element.focus({ preventScroll: true });
    getSelection()?.selectAllChildren(element);
});
document.addEventListener('focusout', event => {
    if (editing && event.target === editing.element) finishEdit(true);
});

/** Keys the editor acts on, sent on when the frame has the keyboard. */
const EDITOR_KEYS = ['z', 'y', 's', 'c', 'v', 'd'];
document.addEventListener('keydown', event => {
    if (editing) {
        if (event.key === 'Enter') {
            event.preventDefault();
            editing.element.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            finishEdit(false);
        }
        return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const command = event.ctrlKey || event.metaKey;
    const plain = ['Delete', 'Backspace', 'ArrowUp', 'ArrowDown', 'Escape', 'p', '?'].includes(key);
    if ((command && EDITOR_KEYS.includes(key)) || (!command && !event.altKey && plain)) {
        event.preventDefault();
        post({ type: 'key', key, command, shift: event.shiftKey });
    }
});

document.addEventListener('mouseover', event => {
    const target = event.target as Element;
    if (target.closest('[data-canvas-ui]')) return;
    const section = sectionOf(target);
    for (const item of sections()) item.classList.toggle('preview-hover', item === section);
    const node = nodeOf(target);
    place(hover, node && node.dataset.u !== selectedNode ? node : null);
    // "Add section" sits on the lower edge of the section under the pointer.
    if (section) {
        const box = section.getBoundingClientRect();
        adderAfter = section.dataset.section ?? null;
        adder.hidden = false;
        adder.style.top = `${box.bottom + window.scrollY}px`;
    }
});
document.addEventListener('mouseleave', () => {
    hover.hidden = true;
    adder.hidden = true;
});

/** Where a dragged element would land: inside which container (null: the section itself), and where. */
interface Landing {
    section: string;
    parent: string | null;
    index: number;
    line: { top: number; left: number; width: number; height: number };
}

function landing(event: DragEvent): Landing | null {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const section = sectionOf(target);
    const root = section?.querySelector<HTMLElement>(':scope > .tree');
    if (!section || !root) return null;
    const over = nodeOf(target);
    // Onto an empty container (or the bare inside of one): it goes in, at the end.
    const into = over?.classList.contains('box') ? over : null;
    const holder = into ?? over?.parentElement?.closest<HTMLElement>('.box') ?? root;
    const children = [...holder.children].filter((child): child is HTMLElement =>
        (child as HTMLElement).hasAttribute('data-node'),
    );
    const flow = getComputedStyle(holder);
    const across =
        (flow.display === 'flex' && flow.flexDirection.startsWith('row')) ||
        (flow.display === 'grid' && flow.gridTemplateColumns.split(' ').length > 1 && holder !== root);
    let index = children.length;
    let edge: DOMRect | null = null;
    let before = false;
    for (const [position, child] of children.entries()) {
        const box = child.getBoundingClientRect();
        const middle = across ? box.left + box.width / 2 : box.top + box.height / 2;
        if ((across ? event.clientX : event.clientY) < middle) {
            index = position;
            edge = box;
            before = true;
            break;
        }
        edge = box;
    }
    const box = edge ?? holder.getBoundingClientRect();
    const line = across
        ? { top: box.top, left: (before || !edge ? box.left : box.right) - 1, width: 3, height: box.height }
        : { top: (before || !edge ? box.top : box.bottom) - 1, left: box.left, width: box.width, height: 3 };
    return {
        section: section.dataset.section ?? '',
        parent: holder === root ? null : (holder.dataset.u ?? null),
        index,
        line: { ...line, top: line.top + window.scrollY, left: line.left + window.scrollX },
    };
}

frame.addEventListener('dragstart', event => {
    const node = findNode(selectedNode);
    if (!node || !event.dataTransfer) return;
    dragging = true;
    event.dataTransfer.setData('text/plain', selectedNode ?? '');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setDragImage(node, 12, 12);
    post({ type: 'drag-start', uid: sectionOf(node)?.dataset.section, node: selectedNode });
});
document.addEventListener('dragend', () => {
    dragging = false;
    dropLine.hidden = true;
    post({ type: 'drag-end' });
});
document.addEventListener('dragover', event => {
    if (!dragging) return;
    const spot = landing(event);
    dropLine.hidden = !spot;
    if (!spot) return;
    event.preventDefault();
    Object.assign(dropLine.style, {
        top: `${spot.line.top}px`,
        left: `${spot.line.left}px`,
        width: `${spot.line.width}px`,
        height: `${spot.line.height}px`,
    });
});
document.addEventListener('drop', event => {
    if (!dragging) return;
    const spot = landing(event);
    dropLine.hidden = true;
    if (!spot) return;
    event.preventDefault();
    post({ type: 'drop', uid: spot.section, parent: spot.parent, index: spot.index });
});

// The outline follows its node when the page moves under it.
window.addEventListener('resize', () => highlight(false));
new ResizeObserver(() => highlight(false)).observe(document.body);

highlight(false);
announce();
