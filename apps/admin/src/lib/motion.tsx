import { AnimatePresence, domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import * as m from 'motion/react-m';
import type { ReactNode } from 'react';

/**
 * Motion (Framer Motion's successor) in its light form: the `m` components with only the
 * `domAnimation` features loaded (no drag or layout animation). Import `m` and `AnimatePresence`
 * from here, never `motion` from 'motion/react': that pulls in the full library.
 *
 * Every animation is switched off for people who ask their device for reduced motion.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
    return (
        <LazyMotion features={domAnimation} strict>
            <MotionConfig reducedMotion="user" transition={EASE}>
                {children}
            </MotionConfig>
        </LazyMotion>
    );
}

/** The admin's one easing: quick, ease-out, no bounce. */
export const EASE = { duration: 0.18, ease: [0.2, 0, 0, 1] } as const;
/** For things that travel (the tour's spotlight, the drawer). */
export const GLIDE = { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 } as const;

/** Fade in and rise 6 px: pages, cards, menus. */
export const rise = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
} as const;

/** Open and close by height, for anything that expands in place. */
export const expand = {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
} as const;

export { AnimatePresence, m };
