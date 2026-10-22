/**
 * Slideshow sections (roadmap phase 15). The slides already swipe without JavaScript (a
 * scroll-snap track); this adds the arrows and the counter, and changing slides every 5 seconds when
 * the merchant chose it. Autoplay never starts for visitors who prefer reduced motion, and stops
 * while the slideshow is touched, hovered or focused, while the tab is hidden, or once paused.
 */

const BANGLA_DIGITS = '০১২৩৪৫৬৭৮৯';
const INTERVAL_MS = 5000;

export function attachSlideshows(root: ParentNode = document) {
    for (const slideshow of root.querySelectorAll<HTMLElement>('[data-slideshow]:not([data-ready])')) {
        slideshow.dataset.ready = '';
        const track = slideshow.querySelector<HTMLElement>('[data-slides]');
        const controls = slideshow.querySelector<HTMLElement>('[data-controls]');
        if (!track || !controls || track.children.length < 2) continue;
        const slides = [...track.children] as HTMLElement[];
        const count = controls.querySelector<HTMLElement>('[data-count]')!;
        // The counter keeps the page's digits (Bangla digits on Bangla pages, when the store uses them).
        const bangla = /[০-৯]/.test(count.textContent ?? '');
        const digits = (n: number) =>
            bangla ? String(n).replace(/\d/g, digit => BANGLA_DIGITS[Number(digit)]!) : String(n);
        const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
        let current = 0;

        const show = (index: number) => {
            const next = (index + slides.length) % slides.length;
            track.scrollTo({ left: next * track.clientWidth, behavior: reduced() ? 'auto' : 'smooth' });
        };
        const update = () => {
            current = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
            count.textContent = `${digits(current + 1)} / ${digits(slides.length)}`;
            slides.forEach((slide, index) => slide.toggleAttribute('inert', index !== current));
        };
        let frame = 0;
        track.addEventListener('scroll', () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(update);
        });
        controls.querySelector('[data-previous]')?.addEventListener('click', () => show(current - 1));
        controls.querySelector('[data-next]')?.addEventListener('click', () => show(current + 1));
        controls.hidden = false;
        update();

        const pause = controls.querySelector<HTMLButtonElement>('[data-pause]');
        if (!pause || slideshow.dataset.autoplay !== 'true' || reduced()) {
            pause?.remove();
            continue;
        }
        let stoppedByVisitor = false;
        let holds = 0;
        const timer = window.setInterval(() => {
            if (!stoppedByVisitor && holds === 0 && !document.hidden) show(current + 1);
        }, INTERVAL_MS);
        const hold = (on: boolean) => {
            holds = Math.max(0, holds + (on ? 1 : -1));
        };
        slideshow.addEventListener('pointerenter', () => hold(true));
        slideshow.addEventListener('pointerleave', () => hold(false));
        slideshow.addEventListener('focusin', () => hold(true));
        slideshow.addEventListener('focusout', () => hold(false));
        // A touch means the shopper is looking: stop for good, as they may be reading.
        track.addEventListener('touchstart', () => (stoppedByVisitor = true), { passive: true });
        pause.addEventListener('click', () => {
            stoppedByVisitor = !stoppedByVisitor;
            pause.classList.toggle('is-paused', stoppedByVisitor);
            pause.setAttribute(
                'aria-label',
                (stoppedByVisitor ? pause.dataset.playLabel : pause.dataset.pauseLabel) ?? '',
            );
        });
        // Removed from the page (the editor's preview redraws it): stop the timer.
        new MutationObserver((_, observer) => {
            if (!slideshow.isConnected) {
                window.clearInterval(timer);
                observer.disconnect();
            }
        }).observe(document.body, { childList: true, subtree: true });
    }
}
