import { animate } from 'motion/mini';

/**
 * Entrance animations of the page builder's elements, and numbers that count up.
 *
 * What is on the first screen enters with the stylesheet alone, as the page loads, so nothing
 * waits hidden for this script. What is further down would have finished long before anyone
 * scrolled to it: this script holds those at their starting pose and lets Motion play each one as
 * it comes into view. Shoppers who ask their device for less motion get none of it.
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const STEP = 90;
const BANGLA = '০১২৩৪৫৬৭৮৯';

const FROM: Record<string, string> = {
    fade: 'none',
    rise: 'translateY(22px)',
    'slide-left': 'translateX(28px)',
    'slide-right': 'translateX(-28px)',
    zoom: 'scale(0.96)',
};

interface Target {
    element: HTMLElement;
    kind: string;
    delay: number;
}

/** The elements that enter: an animated element itself, or each thing inside a staggered container. */
function targets(root: ParentNode): Target[] {
    const list: Target[] = [];
    for (const holder of root.querySelectorAll<HTMLElement>('[data-anim]:not([data-motion])')) {
        holder.dataset.motion = '';
        const kind = holder.dataset.anim ?? 'fade';
        const delay = Number(holder.dataset.animDelay) || 0;
        if (!holder.hasAttribute('data-stagger')) {
            list.push({ element: holder, kind, delay });
            continue;
        }
        const children = [...holder.children].filter(
            (child): child is HTMLElement => child instanceof HTMLElement && child.matches('.box, .el'),
        );
        children.forEach((element, index) => list.push({ element, kind, delay: delay + index * STEP }));
    }
    return list;
}

/** "৫,০০০+" counts up from zero in the digits it is written in. */
function countUp(element: HTMLElement) {
    const text = element.textContent ?? '';
    const match = /[0-9০-৯][0-9০-৯,.]*/.exec(text);
    if (!match) return;
    const bangla = /[০-৯]/.test(match[0]);
    const latin = match[0].replace(/[০-৯]/g, digit => String(BANGLA.indexOf(digit))).replace(/,/g, '');
    const end = Number(latin);
    if (!Number.isFinite(end) || end <= 0 || latin.includes('.')) return;
    const grouped = match[0].includes(',');
    const write = (value: number) => {
        let digits = grouped ? Math.round(value).toLocaleString('en-US') : String(Math.round(value));
        if (bangla) digits = digits.replace(/\d/g, digit => BANGLA[Number(digit)]!);
        element.textContent = text.slice(0, match.index) + digits + text.slice(match.index + match[0].length);
    };
    const started = performance.now();
    const frame = (now: number) => {
        const progress = Math.min(1, (now - started) / 900);
        // Fast at first, settling gently on the number.
        write(end * (1 - Math.pow(1 - progress, 3)));
        if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

function play({ element, kind, delay }: Target) {
    const from = FROM[kind] ?? 'none';
    void animate(
        element,
        { opacity: [0, 1], transform: [from, 'none'] },
        { duration: 0.7, delay: delay / 1000, ease: EASE },
    ).finished.then(() => {
        element.style.removeProperty('opacity');
        element.style.removeProperty('transform');
    });
    for (const number of element.matches('.el-stat')
        ? [element]
        : element.querySelectorAll<HTMLElement>('.el-stat')) {
        const value = number.querySelector<HTMLElement>('.stat-value');
        if (value) window.setTimeout(() => countUp(value), delay);
    }
}

export function attachMotion(root: ParentNode = document) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // In the page editor nothing moves by itself: it would replay on every change.
    if (document.body.dataset.preview === 'editor') return;
    const waiting = new Map<Element, Target>();
    const observer = new IntersectionObserver(
        entries => {
            for (const entry of entries) {
                const target = waiting.get(entry.target);
                if (!entry.isIntersecting || !target) continue;
                observer.unobserve(entry.target);
                waiting.delete(entry.target);
                play(target);
            }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    const fold = window.innerHeight * 0.95;
    for (const target of targets(root)) {
        const { element } = target;
        // On the first screen the stylesheet is already playing it.
        if (element.getBoundingClientRect().top < fold) continue;
        element.style.animation = 'none';
        element.style.opacity = '0';
        element.style.transform = FROM[target.kind] ?? 'none';
        waiting.set(element, target);
        observer.observe(element);
    }
}

/** Plays one element's entrance once, for the page editor's "Play" button. */
export function playMotion(holder: HTMLElement) {
    holder.removeAttribute('data-motion');
    const parent = holder.parentElement ?? document;
    for (const target of targets(parent)) {
        if (target.element === holder || holder.contains(target.element)) {
            target.element.style.animation = 'none';
            play(target);
        }
    }
}
