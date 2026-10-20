import { ChevronsLeft, ChevronsRight, LogOut, Menu as MenuIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigation } from 'react-router';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { LanguageSwitch } from './language-switch';
import { MENU, type MenuGroup, visibleMenu } from './menu';

const COLLAPSED_KEY = 'ecommbd-admin-sidebar-collapsed';

function readCollapsed(): boolean {
    try {
        return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * The signed-in shell: a left sidebar with icons that collapses on desktop and becomes a drawer on
 * phones, a top bar with the language switch and sign-out, and the page.
 */
export function AppLayout() {
    const { messages: m } = useI18n();
    const { can, user, signOut } = useAuth();
    const navigation = useNavigation();
    const location = useLocation();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const menu = visibleMenu(MENU, can);

    useEffect(() => setDrawerOpen(false), [location.pathname]);

    const toggleCollapsed = () => {
        setCollapsed(value => {
            try {
                localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
            } catch {
                // Not remembered: fine.
            }
            return !value;
        });
    };

    return (
        <div className="min-h-dvh lg:flex">
            <a
                href="#main"
                className="sr-only rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
            >
                {m.nav.skipToContent}
            </a>
            {navigation.state === 'loading' && (
                <div
                    className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-teal-600"
                    role="progressbar"
                    aria-label={m.common.loading}
                />
            )}

            {/* Desktop sidebar */}
            <aside
                className={cn(
                    'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-slate-200 bg-white lg:flex',
                    collapsed ? 'w-16' : 'w-64',
                )}
            >
                <div
                    className={cn(
                        'flex h-14 items-center border-b border-slate-100',
                        collapsed ? 'justify-center' : 'px-4',
                    )}
                >
                    {!collapsed && <span className="truncate font-semibold text-teal-800">{m.appName}</span>}
                </div>
                <nav aria-label={m.nav.menu} className="flex-1 overflow-y-auto p-2">
                    <MenuList menu={menu} collapsed={collapsed} />
                </nav>
                <button
                    type="button"
                    onClick={toggleCollapsed}
                    className="flex h-11 items-center gap-2 border-t border-slate-100 px-4 text-sm text-slate-600 hover:bg-slate-50"
                    aria-label={collapsed ? m.nav.expand : m.nav.collapse}
                    title={collapsed ? m.nav.expand : m.nav.collapse}
                >
                    {collapsed ? (
                        <ChevronsRight className="size-4" aria-hidden />
                    ) : (
                        <ChevronsLeft className="size-4" aria-hidden />
                    )}
                    {!collapsed && m.nav.collapse}
                </button>
            </aside>

            {/* Phone drawer */}
            <Dialog open={drawerOpen} onClose={() => setDrawerOpen(false)} title={m.appName} variant="drawer">
                <nav aria-label={m.nav.menu}>
                    <MenuList menu={menu} collapsed={false} />
                </nav>
            </Dialog>

            <div className="min-w-0 flex-1">
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-2 backdrop-blur sm:px-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden"
                        aria-label={m.nav.openMenu}
                        aria-expanded={drawerOpen}
                        onClick={() => setDrawerOpen(true)}
                    >
                        <MenuIcon className="size-5" aria-hidden />
                    </Button>
                    <span className="min-w-0 flex-1 truncate font-semibold text-teal-800 lg:hidden">
                        {m.appName}
                    </span>
                    <div className="hidden flex-1 lg:block" />
                    <LanguageSwitch />
                    <span
                        className="hidden max-w-48 truncate text-sm text-slate-600 md:inline"
                        title={user?.identifier}
                    >
                        {user?.name}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void signOut()}
                        aria-label={m.login.signOut}
                    >
                        <LogOut className="size-4" aria-hidden />
                        <span className="hidden sm:inline">{m.login.signOut}</span>
                    </Button>
                </header>
                <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-6 pb-28 sm:px-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}

function MenuList({ menu, collapsed }: { menu: MenuGroup[]; collapsed: boolean }) {
    const { messages: m } = useI18n();
    const linkClass = ({ isActive }: { isActive: boolean }) =>
        cn(
            'flex min-h-10 items-center gap-3 rounded-md px-3 py-2 text-sm',
            isActive ? 'bg-teal-50 font-medium text-teal-900' : 'text-slate-700 hover:bg-slate-100',
            collapsed && 'justify-center px-0',
        );
    return (
        <ul className="space-y-1">
            {menu.map(group => {
                const Icon = group.icon;
                if (group.link) {
                    const label = m.nav[group.link.label];
                    return (
                        <li key={group.label}>
                            <NavLink
                                to={group.link.to}
                                end
                                className={linkClass}
                                title={collapsed ? label : undefined}
                            >
                                <Icon className="size-5 shrink-0" aria-hidden />
                                {collapsed ? (
                                    <span className="sr-only">{label}</span>
                                ) : (
                                    <span className="min-w-0">{label}</span>
                                )}
                            </NavLink>
                        </li>
                    );
                }
                return (
                    <li key={group.label}>
                        <div
                            className={cn(
                                'flex items-center gap-3 px-3 pt-3 pb-1 text-xs font-semibold text-slate-500',
                                collapsed && 'justify-center px-0',
                            )}
                            title={collapsed ? m.nav[group.label] : undefined}
                        >
                            <Icon className="size-4 shrink-0" aria-hidden />
                            {collapsed ? (
                                <span className="sr-only">{m.nav[group.label]}</span>
                            ) : (
                                m.nav[group.label]
                            )}
                        </div>
                        <ul className="space-y-1">
                            {group.children?.map(child => {
                                const label = m.nav[child.label];
                                return (
                                    <li key={child.to}>
                                        <NavLink
                                            to={child.to}
                                            className={linkClass}
                                            title={collapsed ? label : undefined}
                                        >
                                            {collapsed ? (
                                                <span className="text-xs">{label.slice(0, 2)}</span>
                                            ) : (
                                                <span className="min-w-0 pl-8">{label}</span>
                                            )}
                                        </NavLink>
                                    </li>
                                );
                            })}
                        </ul>
                    </li>
                );
            })}
        </ul>
    );
}
