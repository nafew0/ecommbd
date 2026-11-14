import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { AnimatePresence, GLIDE, m } from '../lib/motion';
import type { Messages } from '../messages/en';

export type TourStep = keyof Messages['tour']['steps'];

/** In this order. Every step except the welcome points at the `data-tour` element of its name. */
export const TOUR_STEPS: TourStep[] = [
    'welcome',
    'orders',
    'products',
    'customers',
    'onlineStore',
    'settings',
    'search',
];

const DONE_KEY = 'ecommbd-admin-tour-done';

/** The tour starts by itself once per device, and never for automated browsers (the tests). */
export function shouldStartTour(): boolean {
    try {
        return !navigator.webdriver && localStorage.getItem(DONE_KEY) !== '1';
    } catch {
        return false;
    }
}

export function markTourDone() {
    try {
        localStorage.setItem(DONE_KEY, '1');
    } catch {
        // Not remembered: the tour shows again next time, and can be skipped again.
    }
}

interface Box {
    top: number;
    left: number;
    width: number;
    height: number;
}

const CARD_WIDTH = 340;
const GAP = 16;

function findTarget(step: TourStep): Box | null {
    if (step === 'welcome') return null;
    const element = [...document.querySelectorAll<HTMLElement>(`[data-tour="${step}"]`)].find(
        candidate => candidate.getClientRects().length > 0,
    );
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) return null;
    return { top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 };
}

const same = (a: Box | null, b: Box | null) =>
    a === b ||
    (a !== null &&
        b !== null &&
        a.top === b.top &&
        a.left === b.left &&
        a.width === b.width &&
        a.height === b.height);

/** Where the card goes: beside the target if there is room, else under it, else the middle. */
function cardPosition(target: Box | null, cardHeight: number): { top: number; left: number } {
    const { innerWidth: vw, innerHeight: vh } = window;
    const width = Math.min(CARD_WIDTH, vw - 2 * GAP);
    const clampTop = (top: number) => Math.max(GAP, Math.min(top, vh - cardHeight - GAP));
    const clampLeft = (left: number) => Math.max(GAP, Math.min(left, vw - width - GAP));
    if (!target) return { top: clampTop((vh - cardHeight) / 2), left: clampLeft((vw - width) / 2) };
    const right = target.left + target.width + GAP;
    if (right + width + GAP <= vw) return { top: clampTop(target.top), left: right };
    const below = target.top + target.height + GAP;
    return { top: clampTop(below), left: clampLeft(target.left + target.width / 2 - width / 2) };
}

interface TourProps {
    open: boolean;
    /** Steps whose menu item this role can't see are left out. */
    steps: TourStep[];
    onStep(step: TourStep | undefined): void;
    onClose(): void;
}

/**
 * A short, skippable tour of the menu for a merchant's first visit. A spotlight glides from one
 * menu item to the next while a small card explains it. On phones, where the menu is in a drawer,
 * the card shows alone in the middle. Skip, Escape or the last step ends it; it can be started
 * again from the account menu or from search.
 */
export function Tour({ open, steps, onStep, onClose }: TourProps) {
    const { messages: t } = useI18n();
    const titleId = useId();
    const card = useRef<HTMLDivElement>(null);
    const next = useRef<HTMLButtonElement>(null);
    const [index, setIndex] = useState(0);
    const [target, setTarget] = useState<Box | null>(null);
    const [cardHeight, setCardHeight] = useState(220);
    const step = steps[Math.min(index, steps.length - 1)] ?? 'welcome';
    const last = index >= steps.length - 1;

    useEffect(() => {
        if (open) setIndex(0);
    }, [open]);

    useEffect(() => {
        onStep(open ? step : undefined);
    }, [open, step, onStep]);

    // The menu group a step points at opens with an animation, so the target is followed for as
    // long as the tour is open rather than measured once.
    useEffect(() => {
        if (!open) return;
        const measure = () =>
            setTarget(current => {
                const found = findTarget(step);
                return same(current, found) ? current : found;
            });
        measure();
        const timer = window.setInterval(measure, 120);
        window.addEventListener('resize', measure);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('resize', measure);
        };
    }, [open, step]);

    useLayoutEffect(() => {
        if (open && card.current) setCardHeight(card.current.offsetHeight);
    }, [open, step, target]);

    useEffect(() => {
        if (open) next.current?.focus({ preventScroll: true });
    }, [open, step]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowRight' && !last) setIndex(value => value + 1);
            if (event.key === 'ArrowLeft') setIndex(value => Math.max(0, value - 1));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, last, onClose]);

    const position = cardPosition(target, cardHeight);
    const copy = t.tour.steps[step];

    return createPortal(
        <AnimatePresence>
            {open && (
                <m.div
                    key="tour"
                    className="fixed inset-0 z-[60]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    {/* Blocks the page under the tour, and dims it when there is nothing to point at. */}
                    <div className={cn('absolute inset-0 transition-colors', !target && 'bg-ink/55')} />
                    {target && (
                        <m.div
                            aria-hidden
                            initial={false}
                            animate={{ ...target }}
                            transition={GLIDE}
                            className="pointer-events-none absolute rounded-lg shadow-[0_0_0_200vmax_rgb(26_26_25/0.55)] ring-2 ring-white/80"
                        />
                    )}
                    <m.div
                        ref={card}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        initial={false}
                        animate={position}
                        transition={GLIDE}
                        style={{ width: `min(${CARD_WIDTH}px, calc(100vw - ${2 * GAP}px))` }}
                        className="absolute rounded-lg bg-surface p-4 shadow-lg"
                    >
                        <div className="mb-3 flex items-center gap-3">
                            <div className="flex flex-1 gap-1" aria-hidden>
                                {steps.map((name, position_) => (
                                    <span
                                        key={name}
                                        className={cn(
                                            'h-1 flex-1 rounded-full transition-colors duration-300',
                                            position_ <= index ? 'bg-ink' : 'bg-line',
                                        )}
                                    />
                                ))}
                            </div>
                            <span className="text-xs text-ink-muted tabular-nums">
                                {t.tour.step(index + 1, steps.length)}
                            </span>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label={t.tour.skip}
                                title={t.tour.skip}
                                className="-m-1 rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                            >
                                <X className="size-4" aria-hidden />
                            </button>
                        </div>
                        <AnimatePresence mode="wait" initial={false}>
                            <m.div
                                key={step}
                                initial={{ opacity: 0, x: 8 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -8 }}
                                transition={{ duration: 0.14 }}
                            >
                                <h2 id={titleId} className="text-base font-semibold">
                                    {copy.title}
                                </h2>
                                <p className="mt-1 text-sm text-ink-muted" aria-live="polite">
                                    {copy.body}
                                </p>
                            </m.div>
                        </AnimatePresence>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            {!last && (
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="min-h-9 rounded-md pr-2 text-[13px] text-ink-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                                >
                                    {t.tour.skip}
                                </button>
                            )}
                            <div className="flex-1" />
                            {index > 0 && (
                                <Button variant="secondary" size="sm" onClick={() => setIndex(index - 1)}>
                                    {t.tour.back}
                                </Button>
                            )}
                            <Button
                                ref={next}
                                size="sm"
                                onClick={() => (last ? onClose() : setIndex(index + 1))}
                            >
                                {last ? t.tour.done : index === 0 ? t.tour.start : t.tour.next}
                            </Button>
                        </div>
                    </m.div>
                </m.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
