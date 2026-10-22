/**
 * Countdowns (roadmap phase 16), on sales pages and in Custom sections. The page is cached, so the
 * server's numbers may be a little old: this script counts from the real deadline. A fixed one ends
 * at its date (stored in UTC, chosen in Dhaka time); an evergreen one gives each visitor the same
 * few hours from their first visit (kept in this browser). When it ends, the merchant's message
 * shows, or the section hides.
 */

const BANGLA = '০১২৩৪৫৬৭৮৯';
const HOUR = 60 * 60 * 1000;

function firstVisit(key: string, now: number): number {
    try {
        const stored = Number(localStorage.getItem(key));
        if (stored > 0 && stored <= now) return stored;
        localStorage.setItem(key, String(now));
    } catch {
        // Private browsing without storage: the count starts on each visit.
    }
    return now;
}

export function attachCountdowns(root: ParentNode = document) {
    for (const element of root.querySelectorAll<HTMLElement>('[data-countdown]:not([data-ready])')) {
        element.dataset.ready = '';
        const now = Date.now();
        const hours = Number(element.dataset.hours);
        const end =
            hours > 0
                ? firstVisit(`bd_cd_${element.dataset.key}`, now) + hours * HOUR
                : Date.parse(element.dataset.ends ?? '');
        if (!Number.isFinite(end)) continue;
        const digits = (value: number) => {
            const text = String(value).padStart(2, '0');
            return element.dataset.digits === 'bn' ? text.replace(/\d/g, d => BANGLA[Number(d)]!) : text;
        };
        const unit = (name: string) => element.querySelector<HTMLElement>(`[data-unit="${name}"]`);
        const tick = () => {
            const left = Math.max(0, end - Date.now());
            const seconds = Math.floor(left / 1000);
            const days = Math.floor(seconds / 86400);
            const values: Record<string, number> = {
                days,
                hours: Math.floor(seconds / 3600) % 24,
                minutes: Math.floor(seconds / 60) % 60,
                seconds: seconds % 60,
            };
            for (const [name, value] of Object.entries(values)) {
                const target = unit(name);
                if (target) target.textContent = digits(value);
            }
            const dayBox = unit('days')?.parentElement;
            if (dayBox) dayBox.hidden = days === 0;
            if (left > 0) {
                setTimeout(tick, 1000 - (Date.now() % 1000));
                return;
            }
            if (element.dataset.expired === 'hide') {
                (element.closest('.section') ?? element).setAttribute('hidden', '');
            } else {
                element.querySelector<HTMLElement>('[data-units]')?.setAttribute('hidden', '');
                element.querySelector<HTMLElement>('[data-ended]')?.removeAttribute('hidden');
            }
        };
        tick();
    }
}
