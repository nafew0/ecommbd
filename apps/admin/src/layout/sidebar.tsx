import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { AnimatePresence, expand, m } from '../lib/motion';
import { activeLink, type Area, type MenuGroup, type MenuLink } from './menu';

export type MenuCounts = Partial<Record<NonNullable<MenuLink['count']>, number | undefined>>;

interface SidebarProps {
    menu: MenuGroup[];
    area: Area;
    counts: MenuCounts;
    /** The tour opens a group to show what is inside it. */
    tourGroup?: string;
}

const MORE_KEY = 'ecommbd-admin-menu-more';

function readMore(): string[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(MORE_KEY) ?? '[]');
        return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

const row =
    'flex min-h-10 w-full items-center gap-3 rounded-md border border-transparent px-3 text-left text-sm text-ink-muted transition-colors hover:bg-line/60 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';
const rowActive = 'border-line bg-surface font-semibold text-ink hover:bg-surface';

/**
 * The left menu (design guide, section 3.2): about ten top-level items, one group open at a time,
 * less-used screens under "More". "Online store" and "Settings" replace it with their own list and
 * a "Back" link. The same component fills the phone drawer.
 */
export function Sidebar({ menu, area, counts, tourGroup }: SidebarProps) {
    const group = area === 'main' ? undefined : menu.find(item => item.area === area);
    return (
        <AnimatePresence mode="wait" initial={false}>
            <m.div
                key={group ? area : 'main'}
                initial={{ opacity: 0, x: group ? 12 : -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: group ? 12 : -12 }}
                transition={{ duration: 0.14 }}
            >
                {group ? (
                    <AreaList group={group} />
                ) : (
                    <MainList menu={menu} counts={counts} tourGroup={tourGroup} />
                )}
            </m.div>
        </AnimatePresence>
    );
}

function MainList({ menu, counts, tourGroup }: Omit<SidebarProps, 'area'>) {
    const { messages: t } = useI18n();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const current = menu.find(group => !group.area && activeLink(group, pathname))?.label;
    const [openGroup, setOpenGroup] = useState(current);
    const [moreOpen, setMoreOpen] = useState(readMore);
    useEffect(() => setOpenGroup(current), [current]);
    const shown = tourGroup ?? openGroup;

    const toggleMore = (label: string) => {
        setMoreOpen(list => {
            const next = list.includes(label) ? list.filter(item => item !== label) : [...list, label];
            try {
                localStorage.setItem(MORE_KEY, JSON.stringify(next));
            } catch {
                // Not remembered: fine.
            }
            return next;
        });
    };

    const firstArea = menu.findIndex(group => group.area);
    return (
        <ul className="space-y-0.5">
            {menu.map((group, index) => {
                const Icon = group.icon;
                const label = t.nav[group.label];
                const divider = index === firstArea && index > 0;
                const item = (content: React.ReactNode) => (
                    <li
                        key={group.label}
                        data-tour={group.label}
                        className={cn(divider && 'mt-3 border-t border-line pt-3')}
                    >
                        {content}
                    </li>
                );
                if (group.link) {
                    return item(
                        <NavLink
                            to={group.link.to}
                            end
                            className={({ isActive }) => cn(row, isActive && rowActive)}
                        >
                            <Icon className="size-[18px] shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1">{label}</span>
                        </NavLink>,
                    );
                }
                const children = group.children ?? [];
                const first = children[0];
                if (!first) return null;
                if (group.area) {
                    return item(
                        <Link to={first.to} className={row}>
                            <Icon className="size-[18px] shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1">{label}</span>
                            <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
                        </Link>,
                    );
                }
                const active = activeLink(group, pathname);
                const open = shown === group.label;
                const count = (link: MenuLink) => (link.count ? (counts[link.count] ?? 0) : 0);
                const total = children.reduce((sum, link) => sum + count(link), 0);
                const always = children.filter(link => !link.more || link === active || count(link) > 0);
                const extra = children.filter(link => !always.includes(link));
                const showExtra = moreOpen.includes(group.label);
                return item(
                    <>
                        <button
                            type="button"
                            aria-expanded={open}
                            className={cn(row, open && 'text-ink')}
                            onClick={() => {
                                setOpenGroup(group.label);
                                if (!active) void navigate(first.to);
                            }}
                        >
                            <Icon className="size-[18px] shrink-0" aria-hidden />
                            <span className={cn('min-w-0 flex-1', open && 'font-semibold')}>{label}</span>
                            {!open && total > 0 && <Count value={total} />}
                            <ChevronDown
                                className={cn(
                                    'size-4 shrink-0 text-ink-faint transition-transform',
                                    open && 'rotate-180',
                                )}
                                aria-hidden
                            />
                        </button>
                        <AnimatePresence initial={false}>
                            {open && (
                                <m.ul
                                    {...expand}
                                    className="ml-[21px] overflow-hidden border-l border-line pl-3"
                                >
                                    {[...always, ...(showExtra ? extra : [])].map(link => (
                                        <li key={link.to} className="pt-0.5">
                                            <Link
                                                to={link.to}
                                                aria-current={link === active ? 'page' : undefined}
                                                className={cn(row, 'min-h-9', link === active && rowActive)}
                                            >
                                                <span className="min-w-0 flex-1">{t.nav[link.label]}</span>
                                                {count(link) > 0 && <Count value={count(link)} />}
                                            </Link>
                                        </li>
                                    ))}
                                    {extra.length > 0 && (
                                        <li className="pt-0.5">
                                            <button
                                                type="button"
                                                aria-expanded={showExtra}
                                                onClick={() => toggleMore(group.label)}
                                                className={cn(row, 'min-h-9 text-[13px]')}
                                            >
                                                <span className="min-w-0 flex-1">
                                                    {showExtra ? t.nav.less : t.nav.more}
                                                </span>
                                                <ChevronDown
                                                    className={cn(
                                                        'size-4 shrink-0 text-ink-faint transition-transform',
                                                        showExtra && 'rotate-180',
                                                    )}
                                                    aria-hidden
                                                />
                                            </button>
                                        </li>
                                    )}
                                </m.ul>
                            )}
                        </AnimatePresence>
                    </>,
                );
            })}
        </ul>
    );
}

/** "Online store" or "Settings": a Back link, then that area's screens under their headings. */
function AreaList({ group }: { group: MenuGroup }) {
    const { messages: t } = useI18n();
    const { pathname } = useLocation();
    const Icon = group.icon;
    const active = activeLink(group, pathname);
    const sections: Array<{ heading?: string; links: MenuLink[] }> = [];
    for (const link of group.children ?? []) {
        const heading = link.section ? t.nav[link.section] : undefined;
        const last = sections[sections.length - 1];
        if (last && last.heading === heading) last.links.push(link);
        else sections.push({ heading, links: [link] });
    }
    return (
        <div>
            <Link to="/" className={cn(row, 'mb-3 text-[13px]')}>
                <ArrowLeft className="size-4 shrink-0" aria-hidden />
                {t.nav.back}
            </Link>
            <p className="mb-2 flex items-center gap-3 px-3 font-semibold">
                <Icon className="size-[18px] shrink-0" aria-hidden />
                {t.nav[group.label]}
            </p>
            {sections.map((section, index) => (
                <div key={section.heading ?? index} className="mb-3">
                    {section.heading && (
                        <p className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-muted">
                            {section.heading}
                        </p>
                    )}
                    <ul className="space-y-0.5">
                        {section.links.map(link => (
                            <li key={link.to}>
                                <Link
                                    to={link.to}
                                    aria-current={link === active ? 'page' : undefined}
                                    className={cn(row, link === active && rowActive)}
                                >
                                    {t.nav[link.label]}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

function Count({ value }: { value: number }) {
    const { messages: t } = useI18n();
    return (
        <span className="rounded-md bg-warn-soft px-1.5 text-xs font-semibold text-warn tabular-nums">
            {t.common.number(value)}
        </span>
    );
}
