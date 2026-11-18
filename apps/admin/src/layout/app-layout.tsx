import { Compass, ExternalLink, LogOut, Menu as MenuIcon, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigation } from 'react-router';
import { ActionMenu } from '../components/ui/action-menu';
import { Dialog } from '../components/ui/dialog';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { m as motion } from '../lib/motion';
import { CommandSearch } from './command-search';
import { LanguageSwitch } from './language-switch';
import { areaOf, MENU, visibleMenu } from './menu';
import { Notifications } from './notifications';
import { Sidebar } from './sidebar';
import { useShell } from './use-shell';
import { markTourDone, shouldStartTour, Tour, TOUR_STEPS, type TourStep } from './tour';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The signed-in shell (design guide, section 3): a dark top bar with search and the account menu,
 * a left menu that becomes a drawer on phones, and the page. A first visit starts a short tour.
 */
export function AppLayout() {
    const { messages: m, language } = useI18n();
    const { can, user, signOut } = useAuth();
    const navigation = useNavigation();
    const location = useLocation();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [tourOpen, setTourOpen] = useState(false);
    const [tourStep, setTourStep] = useState<TourStep>();
    const menu = useMemo(() => visibleMenu(MENU, can), [can]);
    const area = areaOf(location.pathname);

    const { shell, attention } = useShell();
    const storeName = shell?.storeName[language] || shell?.storeName.bn || shell?.storeName.en || m.appName;

    useEffect(() => setDrawerOpen(false), [location.pathname]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // The tour greets a first visit on the home screen only, never in the middle of other work.
    useEffect(() => {
        if (location.pathname === '/' && shouldStartTour()) setTourOpen(true);
        // Once, when the shell first shows.
    }, []);

    const startTour = useCallback(() => {
        setSearchOpen(false);
        setDrawerOpen(false);
        setTourOpen(true);
    }, []);
    const closeTour = useCallback(() => {
        markTourDone();
        setTourOpen(false);
    }, []);
    const tourSteps = useMemo(
        () =>
            TOUR_STEPS.filter(
                step => step === 'welcome' || step === 'search' || menu.some(group => group.label === step),
            ),
        [menu],
    );
    // While the tour points at a group, the menu opens it to show what's inside.
    const tourGroup = tourOpen && area === 'main' ? tourStep : undefined;

    const sidebar = (
        <Sidebar menu={menu} area={tourOpen ? 'main' : area} counts={attention} tourGroup={tourGroup} />
    );
    const initial = (user?.name ?? user?.identifier ?? '?').trim().charAt(0).toUpperCase();

    return (
        <div className="min-h-dvh">
            <a
                href="#main"
                className="sr-only rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
            >
                {m.nav.skipToContent}
            </a>
            {navigation.state === 'loading' && (
                <div
                    className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-accent"
                    role="progressbar"
                    aria-label={m.common.loading}
                />
            )}

            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 bg-bar px-2 text-white sm:px-4">
                <button
                    type="button"
                    className="inline-flex size-10 items-center justify-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white lg:hidden"
                    aria-label={m.nav.openMenu}
                    aria-expanded={drawerOpen}
                    onClick={() => setDrawerOpen(true)}
                >
                    <MenuIcon className="size-5" aria-hidden />
                </button>
                <span className="min-w-0 shrink truncate font-semibold lg:w-56 lg:shrink-0">{storeName}</span>
                <div className="flex flex-1 justify-end lg:min-w-0 lg:justify-center">
                    <button
                        type="button"
                        data-tour="search"
                        onClick={() => setSearchOpen(true)}
                        aria-label={m.finder.open}
                        aria-keyshortcuts="Control+K Meta+K"
                        className="inline-flex size-10 items-center justify-center gap-2 rounded-md text-white/70 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-white lg:h-9 lg:w-full lg:max-w-md lg:justify-start lg:bg-white/10 lg:px-3"
                    >
                        <Search className="size-5 shrink-0 lg:size-4" aria-hidden />
                        <span className="hidden min-w-0 flex-1 truncate text-left text-sm lg:block">
                            {m.finder.placeholder}
                        </span>
                        <kbd className="hidden rounded border border-white/20 px-1.5 font-sans text-xs lg:block">
                            {isMac ? '⌘ K' : 'Ctrl K'}
                        </kbd>
                    </button>
                </div>
                {shell?.storefrontUrl && (
                    <a
                        href={shell.storefrontUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={m.nav.viewStore}
                        className="hidden min-h-9 items-center gap-1.5 rounded-md px-2 text-sm text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white md:inline-flex"
                    >
                        <ExternalLink className="size-4" aria-hidden />
                        {m.nav.viewStore}
                    </a>
                )}
                <LanguageSwitch tone="dark" />
                <Notifications attention={attention} />
                <ActionMenu
                    label={m.nav.account}
                    variant="ghost"
                    size="icon"
                    className="rounded-full hover:bg-white/10"
                    trigger={
                        <span
                            className="flex size-8 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
                            title={user?.name}
                        >
                            {initial}
                        </span>
                    }
                    items={[
                        {
                            label: m.tour.again,
                            icon: <Compass className="size-4" aria-hidden />,
                            onSelect: startTour,
                        },
                        {
                            label: m.login.signOut,
                            icon: <LogOut className="size-4" aria-hidden />,
                            onSelect: () => void signOut(),
                        },
                    ]}
                />
            </header>

            <div className="lg:flex">
                <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-line p-3 lg:block">
                    <nav aria-label={m.nav.menu}>{sidebar}</nav>
                </aside>

                {/* Phone drawer */}
                <Dialog
                    open={drawerOpen}
                    onClose={() => setDrawerOpen(false)}
                    title={m.appName}
                    variant="drawer"
                >
                    <nav aria-label={m.nav.menu}>{sidebar}</nav>
                </Dialog>

                <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 pb-28 outline-none sm:px-6">
                    {/* Screens set their own width with <Page>. One that doesn't yet (before phase
                        63b reaches it) gets the middle width. */}
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mx-auto w-full max-w-[1120px] has-[[data-page]]:max-w-none"
                    >
                        <Outlet />
                    </motion.div>
                </main>
            </div>

            <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} onStartTour={startTour} />
            <Tour<TourStep> open={tourOpen} steps={tourSteps} onStep={setTourStep} onClose={closeTour} />
        </div>
    );
}
