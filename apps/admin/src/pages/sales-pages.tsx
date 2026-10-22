import {
    LANDING_CATEGORIES,
    LANDING_CATEGORY_NAMES,
    LANDING_TEMPLATES,
    type LandingCategory,
    landingTemplate,
    pick,
    SALES_LIMITS,
    toSalesSlug,
} from '@ecommbd/sections';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, ExternalLink, PanelsTopLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
    createPreviewLink,
    createSalesPage,
    deleteSalesPage,
    duplicateSalesPage,
    fetchSalesPages,
    type SalesPage,
    type SalesPageProblem,
    type SalesPageStatus,
} from '../components/design/design-api';
import { LandingTemplateCard } from '../components/design/dialogs';
import { ProductPickerDialog, ProductThumb, useProducts } from '../components/design/pickers';
import { RowMenu } from '../components/design/section-list';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Badge, type BadgeTone, EmptyState, PageHeader } from '../components/ui/misc';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDebounced } from '../lib/use-debounced';

/**
 * Sales pages (roadmap phase 16): Facebook-ad landing pages for one product. The list shows each
 * page's address, template, product, price, status and the orders it brought; a new page starts
 * from one of twelve templates and a product, then opens in the page editor.
 */

const PAGE_SIZE = 25;

const STATUS_TONE: Record<SalesPageStatus, BadgeTone> = {
    live: 'green',
    off: 'slate',
    notPublished: 'amber',
    productMissing: 'red',
};

export function SalesPagesPage() {
    const { messages: m, language } = useI18n();
    const t = m.salesPages;
    const format = useFormat();
    const toast = useToast();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { can } = useAuth();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const term = useDebounced(search, 300);
    const query = useQuery({
        queryKey: ['salesPages', term, page],
        queryFn: () => fetchSalesPages(term, (page - 1) * PAGE_SIZE, PAGE_SIZE),
    });
    const rows = query.data?.items ?? [];
    const products = useProducts(rows.map(row => row.productId).filter((id): id is string => !!id));
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['salesPages'] });

    if (!can('EditStorefront'))
        return <p className="p-10 text-center text-slate-700">{m.errors.forbidden}</p>;

    const startingPrice = (row: SalesPage) => {
        const packs = row.settings.packs;
        return packs.length ? Math.min(...packs.map(pack => pack.price)) : null;
    };

    const columns: Column<SalesPage>[] = [
        {
            key: 'title',
            header: t.columns.title,
            cell: row => (
                <div className="min-w-0">
                    <Link
                        to={`/store/design/landing/${row.id}`}
                        className="font-medium text-teal-800 hover:underline"
                    >
                        {row.title}
                    </Link>
                    <p className="truncate text-xs text-slate-500">/s/{row.slug}/</p>
                </div>
            ),
        },
        {
            key: 'template',
            header: t.columns.template,
            hideOnMobile: true,
            cell: row => {
                const template = landingTemplate(row.template);
                return template ? pick(template.name, language) : '—';
            },
        },
        {
            key: 'product',
            header: t.columns.product,
            hideOnMobile: true,
            cell: row => {
                const product = row.productId ? products.data?.get(row.productId) : undefined;
                return row.productId ? (
                    <span className="flex items-center gap-2">
                        <ProductThumb product={product} size="size-8" />
                        <span className="max-w-40 truncate">{product?.name ?? '…'}</span>
                    </span>
                ) : (
                    <span className="text-red-700">{t.productDeleted}</span>
                );
            },
        },
        {
            key: 'price',
            header: t.columns.price,
            hideOnMobile: true,
            cell: row => {
                const price = startingPrice(row);
                return price != null ? t.from(format.money(price)) : '—';
            },
        },
        {
            key: 'status',
            header: t.columns.status,
            cell: row => <Badge tone={STATUS_TONE[row.status]}>{t.status[row.status]}</Badge>,
        },
        {
            key: 'orders',
            header: t.columns.orders,
            cell: row =>
                row.orderCount ? (
                    <Link
                        to={`/orders?salesPageId=${encodeURIComponent(row.id)}`}
                        className="font-medium text-teal-800 tabular-nums hover:underline"
                    >
                        {m.common.number(row.orderCount)}
                    </Link>
                ) : (
                    <span className="text-slate-500 tabular-nums">{m.common.number(0)}</span>
                ),
        },
        {
            key: 'actions',
            header: '',
            className: 'w-12',
            cell: row => (
                <RowMenu
                    label={t.actionsFor(row.title)}
                    items={[
                        {
                            label: t.edit,
                            icon: Pencil,
                            run: () => navigate(`/store/design/landing/${row.id}`),
                        },
                        {
                            label: t.preview,
                            icon: Eye,
                            disabled: !row.layoutId,
                            run: async () => {
                                const link = await createPreviewLink(row.layoutId!, language, true);
                                window.open(link.url, '_blank', 'noopener');
                            },
                        },
                        {
                            label: t.open,
                            icon: ExternalLink,
                            disabled: row.status !== 'live',
                            run: () => window.open(row.url, '_blank', 'noopener'),
                        },
                        {
                            label: t.duplicate,
                            icon: Copy,
                            run: async () => {
                                const result = await duplicateSalesPage(row.id);
                                if (result.page) {
                                    toast.success(t.duplicated);
                                    refresh();
                                }
                            },
                        },
                        {
                            label: t.delete,
                            icon: Trash2,
                            danger: true,
                            run: async () => {
                                if (
                                    await confirm({
                                        title: t.deleteTitle,
                                        body: t.deleteBody(row.title),
                                        danger: true,
                                        confirmLabel: t.delete,
                                    })
                                ) {
                                    await deleteSalesPage(row.id);
                                    toast.success(t.deleted);
                                    refresh();
                                }
                            },
                        },
                    ]}
                />
            ),
        },
    ];

    const newButton = (
        <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t.newPage}
        </Button>
    );

    return (
        <>
            <PageHeader title={t.title} description={t.description} actions={newButton} />
            <ListPage
                rows={rows}
                rowId={row => row.id}
                columns={columns}
                loading={query.isPending}
                search={{
                    value: search,
                    onChange: value => (setSearch(value), setPage(1)),
                    placeholder: t.search,
                }}
                pagination={
                    (query.data?.totalItems ?? 0) > PAGE_SIZE
                        ? { page, pageSize: PAGE_SIZE, total: query.data!.totalItems, onChange: setPage }
                        : undefined
                }
                empty={
                    <EmptyState
                        icon={<PanelsTopLeft className="size-6" aria-hidden />}
                        title={term ? t.noMatches : t.emptyTitle}
                        body={term ? '' : t.emptyBody}
                        action={term ? undefined : newButton}
                    />
                }
            />
            <CreateSalesPageDialog
                open={creating}
                onClose={() => setCreating(false)}
                onCreated={created => navigate(`/store/design/landing/${created.id}`)}
            />
        </>
    );
}

/** Title and address, a template (by kind of product) and the product: about a minute. */
function CreateSalesPageDialog({
    open,
    onClose,
    onCreated,
}: {
    open: boolean;
    onClose(): void;
    onCreated(page: SalesPage): void;
}) {
    const { messages: m, language } = useI18n();
    const t = m.salesPages;
    const ids = useId();
    const [title, setTitle] = useState('');
    const [slug, setSlug] = useState('');
    const [slugTouched, setSlugTouched] = useState(false);
    const [category, setCategory] = useState<LandingCategory>('food');
    const [template, setTemplate] = useState('');
    const [productId, setProductId] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [errors, setErrors] = useState<SalesPageProblem[]>([]);
    const [saving, setSaving] = useState(false);
    const products = useProducts(productId ? [productId] : []);
    const product = productId ? products.data?.get(productId) : undefined;
    const shownSlug = slugTouched ? slug : toSalesSlug(title);
    const errorFor = (name: string) => errors.find(error => error.field === name);

    const reset = () => {
        setTitle('');
        setSlug('');
        setSlugTouched(false);
        setTemplate('');
        setProductId(null);
        setErrors([]);
    };

    const create = async () => {
        setSaving(true);
        try {
            const result = await createSalesPage({
                title,
                slug: shownSlug,
                template,
                productId: productId ?? undefined,
            });
            setErrors(result.errors);
            if (result.page) {
                reset();
                onCreated(result.page);
            }
        } finally {
            setSaving(false);
        }
    };

    const slugError = errorFor('slug');
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={t.createTitle}
            description={t.createDescription}
            size="wide"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>
                        {m.common.cancel}
                    </Button>
                    <Button
                        loading={saving}
                        disabled={!title.trim() || !template || !productId}
                        onClick={() => void create()}
                    >
                        {t.create}
                    </Button>
                </>
            }
        >
            <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label
                            htmlFor={`${ids}-title`}
                            className="mb-1.5 block text-sm font-medium text-slate-800"
                        >
                            {t.titleLabel}
                        </label>
                        <Input
                            id={`${ids}-title`}
                            value={title}
                            maxLength={SALES_LIMITS.title}
                            placeholder={t.titlePlaceholder}
                            onChange={event => setTitle(event.target.value)}
                            aria-invalid={errorFor('title') ? true : undefined}
                        />
                        {errorFor('title') && (
                            <p className="mt-1 text-xs text-red-700">{t.problems[errorFor('title')!.code]}</p>
                        )}
                    </div>
                    <div>
                        <label
                            htmlFor={`${ids}-slug`}
                            className="mb-1.5 block text-sm font-medium text-slate-800"
                        >
                            {t.address}
                        </label>
                        <div className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white focus-within:outline-2 focus-within:outline-teal-600">
                            <span className="pl-3 text-slate-500" aria-hidden>
                                /s/
                            </span>
                            <input
                                id={`${ids}-slug`}
                                className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-0.5 text-base outline-none"
                                value={shownSlug}
                                maxLength={SALES_LIMITS.slug}
                                aria-invalid={slugError ? true : undefined}
                                onChange={event => {
                                    setSlugTouched(true);
                                    setSlug(event.target.value);
                                }}
                                onBlur={() => slugTouched && setSlug(toSalesSlug(slug))}
                            />
                        </div>
                        {slugError && (
                            <p className="mt-1 text-xs text-red-700">
                                {t.problems[slugError.code] ?? slugError.code}
                                {slugError.suggestion && (
                                    <button
                                        type="button"
                                        className="ml-1 font-medium text-teal-800 underline"
                                        onClick={() => {
                                            setSlugTouched(true);
                                            setSlug(slugError.suggestion!);
                                            setErrors(errors.filter(error => error !== slugError));
                                        }}
                                    >
                                        {t.useSuggestion(slugError.suggestion)}
                                    </button>
                                )}
                            </p>
                        )}
                    </div>
                </div>

                <section>
                    <h3 className="mb-2 text-sm font-medium text-slate-800">{t.product}</h3>
                    <div className="flex items-center gap-3 rounded-md border border-slate-200 p-2">
                        <ProductThumb product={product} size="size-12" />
                        <span className="min-w-0 flex-1 truncate">
                            {product?.name ?? t.chooseProductHint}
                        </span>
                        <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
                            {productId ? m.design.change : m.design.chooseProduct}
                        </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-500">{t.productHint}</p>
                    {errorFor('productId') && (
                        <p className="mt-1 text-xs text-red-700">{t.problems[errorFor('productId')!.code]}</p>
                    )}
                </section>

                <section>
                    <h3 className="mb-2 text-sm font-medium text-slate-800">{t.template}</h3>
                    <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label={t.template}>
                        {LANDING_CATEGORIES.map(item => (
                            <button
                                key={item}
                                type="button"
                                role="tab"
                                aria-selected={category === item}
                                onClick={() => setCategory(item)}
                                className={cn(
                                    'rounded-md border px-3 py-1.5 text-sm font-medium',
                                    category === item
                                        ? 'border-teal-700 bg-teal-50 text-teal-800'
                                        : 'border-slate-200 text-slate-700 hover:border-slate-300',
                                )}
                            >
                                {pick(LANDING_CATEGORY_NAMES[item], language)}
                            </button>
                        ))}
                    </div>
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {LANDING_TEMPLATES.filter(item => item.category === category).map(item => (
                            <li key={item.id}>
                                <LandingTemplateCard
                                    id={item.id}
                                    selected={template === item.id}
                                    onPick={() => setTemplate(item.id)}
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            </div>
            {picking && (
                <ProductPickerDialog
                    open
                    onClose={() => setPicking(false)}
                    selected={productId ? [productId] : []}
                    max={1}
                    onDone={picked => setProductId(picked[0] ?? null)}
                />
            )}
        </Dialog>
    );
}

export default SalesPagesPage;
