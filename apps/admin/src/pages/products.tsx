import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useDigits } from '../components/form/inputs';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Badge, EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { useDebounced } from '../lib/use-debounced';

const PRODUCTS = `
    query Products($search: String, $skip: Int, $take: Int) {
        bdProducts(search: $search, skip: $skip, take: $take) {
            totalItems
            items { id name banglaMissing preview categoryName price oldPrice stock variantCount featured isNew enabled }
        }
    }
`;

const DUPLICATE = `
    mutation Duplicate($id: ID!) {
        duplicateEntity(input: {
            entityName: "Product", entityId: $id,
            duplicatorInput: { code: "product-duplicator", arguments: [{ name: "includeVariants", value: "true" }] }
        }) {
            ... on DuplicateEntitySuccess { newEntityId }
            ... on DuplicateEntityError { message }
        }
    }
`;

const DELETE = `mutation Delete($id: ID!) { deleteProduct(id: $id) { result message } }`;

interface ProductRow {
    id: string;
    name: string;
    banglaMissing: boolean;
    preview: string | null;
    categoryName: string | null;
    price: number;
    oldPrice: number | null;
    stock: number;
    variantCount: number;
    featured: boolean;
    isNew: boolean;
    enabled: boolean;
}

const PAGE_SIZE = 25;

/** All products (roadmap phase 05): image, name, category, price, stock, badges; edit, duplicate, delete. */
export function ProductsPage() {
    const { messages: m } = useI18n();
    const p = m.products;
    const format = useFormat();
    const digits = useDigits();
    const { can } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const term = useDebounced(search.trim());
    const query = useQuery({
        queryKey: ['products', term, page],
        queryFn: () =>
            adminApi<{ bdProducts: { totalItems: number; items: ProductRow[] } }>(PRODUCTS, {
                search: term || null,
                skip: (page - 1) * PAGE_SIZE,
                take: PAGE_SIZE,
            }).then(result => result.bdProducts),
    });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['products'] });

    const duplicate = async (row: ProductRow) => {
        type Result = { duplicateEntity: { newEntityId?: string; message?: string } };
        const { duplicateEntity } = await adminApi<Result>(DUPLICATE, { id: row.id }).catch((): Result => ({
            duplicateEntity: { message: m.errors.generic },
        }));
        if (duplicateEntity.newEntityId) {
            toast.success(p.duplicated);
            navigate(`/products/${duplicateEntity.newEntityId}`);
        } else {
            toast.error(duplicateEntity.message ?? m.errors.generic);
        }
    };

    const remove = async (row: ProductRow) => {
        if (
            !(await confirm({
                title: p.deleteTitle(row.name),
                body: p.deleteBody,
                confirmLabel: m.common.delete,
                danger: true,
            }))
        ) {
            return;
        }
        await adminApi(DELETE, { id: row.id }).then(
            () => toast.success(p.deleted),
            () => toast.error(m.errors.generic),
        );
        refresh();
    };

    const columns: Column<ProductRow>[] = [
        {
            key: 'name',
            header: p.columns.product,
            cell: row => (
                <div className="flex items-center gap-3">
                    {row.preview ? (
                        <img
                            src={`${row.preview}?preset=tiny`}
                            alt=""
                            className="size-12 shrink-0 rounded object-cover"
                        />
                    ) : (
                        <div className="flex size-12 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-400">
                            <Package className="size-5" aria-hidden />
                        </div>
                    )}
                    <div className="min-w-0">
                        <Link
                            to={`/products/${row.id}`}
                            className="font-medium text-teal-800 hover:underline"
                        >
                            {row.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {row.featured && <Badge tone="violet">{p.featured}</Badge>}
                            {row.isNew && <Badge tone="sky">{p.isNew}</Badge>}
                            {!row.enabled && <Badge tone="slate">{p.hidden}</Badge>}
                            {row.banglaMissing && <Badge tone="amber">{p.banglaMissing}</Badge>}
                        </div>
                    </div>
                </div>
            ),
        },
        {
            key: 'category',
            header: p.columns.category,
            hideOnMobile: true,
            cell: row => row.categoryName ?? '—',
        },
        {
            key: 'price',
            header: p.columns.price,
            cell: row => (
                <span className="tabular-nums">
                    {format.money(row.price)}
                    {row.oldPrice && (
                        <span className="ml-1 text-sm text-slate-500 line-through">
                            {format.money(row.oldPrice)}
                        </span>
                    )}
                </span>
            ),
        },
        {
            key: 'stock',
            header: p.columns.stock,
            cell: row => (
                <span className={row.stock <= 5 ? 'font-medium text-red-700' : undefined}>
                    {digits(row.stock)}
                    {row.variantCount > 1 && (
                        <span className="text-sm text-slate-500"> · {p.variants(row.variantCount)}</span>
                    )}
                </span>
            ),
        },
        {
            key: 'actions',
            header: '',
            cell: row => (
                <div className="flex justify-end gap-1">
                    <Button
                        size="icon"
                        variant="ghost"
                        aria-label={p.edit}
                        onClick={() => navigate(`/products/${row.id}`)}
                    >
                        <Pencil className="size-4" aria-hidden />
                    </Button>
                    {can('CreateProduct') && (
                        <Button
                            size="icon"
                            variant="ghost"
                            aria-label={p.duplicate}
                            onClick={() => void duplicate(row)}
                        >
                            <Copy className="size-4" aria-hidden />
                        </Button>
                    )}
                    {can('DeleteProduct') && (
                        <Button
                            size="icon"
                            variant="ghost"
                            aria-label={m.common.delete}
                            onClick={() => void remove(row)}
                        >
                            <Trash2 className="size-4 text-red-700" aria-hidden />
                        </Button>
                    )}
                </div>
            ),
        },
    ];

    return (
        <>
            <PageHeader
                title={p.title}
                description={p.description}
                actions={
                    can('CreateProduct') && (
                        <Button onClick={() => navigate('/products/new')}>
                            <Plus className="size-4" aria-hidden /> {p.add}
                        </Button>
                    )
                }
            />
            <ListPage
                rows={query.data?.items ?? []}
                rowId={row => row.id}
                columns={columns}
                loading={query.isPending}
                search={{
                    value: search,
                    onChange: value => (setSearch(value), setPage(1)),
                    placeholder: p.search,
                }}
                pagination={{
                    page,
                    pageSize: PAGE_SIZE,
                    total: query.data?.totalItems ?? 0,
                    onChange: setPage,
                }}
                empty={
                    <EmptyState icon={<Package className="size-6" aria-hidden />} title={p.empty} body="" />
                }
            />
        </>
    );
}
