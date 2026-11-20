import { pick, SYSTEM_LAYOUTS, SYSTEM_PAGES } from '@ecommbd/sections';
import { Link } from 'react-router';
import { ElementIcon } from '../components/design/element-icon';
import { Page } from '../components/ui/layout';
import { PageHeader } from '../components/ui/misc';
import { MENU, visibleMenu } from '../layout/menu';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { m, rise } from '../lib/motion';

/**
 * Online store: where "Online store" in the menu lands. One line for each thing a merchant can
 * design or set up for shoppers (the home page, the product page, sales pages, pages, menus, the
 * theme, search), with what it's for. It follows the menu itself, so a screen added there shows
 * here, and a role sees only what it may open.
 */
export function OnlineStorePage() {
    const { messages: t, language } = useI18n();
    const { can } = useAuth();
    const store = visibleMenu(MENU, can).find(group => group.area === 'store');
    // The product page sits with the other shop pages below.
    const links = (store?.children ?? []).filter(
        link => link.to !== '/store' && link.to !== '/store/design/product',
    );
    const copy = t.storeHome;
    return (
        <Page width="narrow">
            <PageHeader title={t.nav.onlineStore} description={copy.description} />
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                {links.map((link, index) => (
                    <m.li key={link.to} {...rise} transition={{ duration: 0.18, delay: index * 0.03 }}>
                        <Link
                            to={link.to}
                            className="group flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                        >
                            <span className="min-w-0 flex-1">
                                <span className="block font-medium text-ink">{t.nav[link.label]}</span>
                                <span className="block text-sm text-ink-muted">
                                    {(copy.items as Record<string, string>)[link.label]}
                                </span>
                            </span>
                            <ElementIcon
                                name="chevron"
                                className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                            />
                        </Link>
                    </m.li>
                ))}
            </ul>
            {can('EditStorefront') && (
                <section className="mt-8" aria-labelledby="shop-pages">
                    <h2 id="shop-pages" className="text-base font-semibold text-ink">
                        {copy.shopPages}
                    </h2>
                    <p className="mt-1 mb-3 text-sm text-ink-muted">{copy.shopPagesHint}</p>
                    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
                        {SYSTEM_LAYOUTS.map((type, index) => (
                            <m.li
                                key={type}
                                {...rise}
                                transition={{ duration: 0.18, delay: 0.15 + index * 0.03 }}
                            >
                                <Link
                                    to={`/store/design/${type}`}
                                    className="group flex min-h-16 items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-medium text-ink">
                                            {pick(SYSTEM_PAGES[type].name, language)}
                                        </span>
                                        <span className="block text-sm text-ink-muted">
                                            {pick(SYSTEM_PAGES[type].description, language)}
                                        </span>
                                    </span>
                                    <ElementIcon
                                        name="chevron"
                                        className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                                    />
                                </Link>
                            </m.li>
                        ))}
                    </ul>
                </section>
            )}
        </Page>
    );
}
