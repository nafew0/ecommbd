import { useQuery } from '@tanstack/react-query';
import { Check, ImageOff, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { useDebounced } from '../../lib/use-debounced';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';
import {
    type CollectionOption,
    fetchCollections,
    type ProductOption,
    productsById,
    searchProducts,
} from './design-api';

/** Product and category pickers for section fields (roadmap phase 15). */

export function ProductThumb({ product, size = 'size-10' }: { product?: ProductOption; size?: string }) {
    return (
        <span
            className={cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded bg-surface-muted',
                size,
            )}
        >
            {product?.featuredAsset ? (
                <img
                    src={`${product.featuredAsset.preview}?preset=thumb`}
                    alt=""
                    className="size-full object-cover"
                />
            ) : (
                <ImageOff className="size-4 text-ink-faint" aria-hidden />
            )}
        </span>
    );
}

/** Names and photos of picked products, for the field's list. */
export function useProducts(ids: string[]) {
    return useQuery({
        queryKey: ['designProducts', [...ids].sort().join(',')],
        enabled: ids.length > 0,
        staleTime: 60_000,
        queryFn: () => productsById(ids),
        select: items => new Map(items.map(item => [item.id, item])),
    });
}

export function useCollections() {
    return useQuery({ queryKey: ['designCollections'], queryFn: fetchCollections, staleTime: 60_000 });
}

export const collectionLabel = (collection: CollectionOption) =>
    collection.path.join(' / ') || collection.name;

/** Search products by name and pick one (max 1) or several. */
export function ProductPickerDialog({
    open,
    onClose,
    selected,
    max,
    onDone,
}: {
    open: boolean;
    onClose(): void;
    selected: string[];
    max: number;
    onDone(ids: string[]): void;
}) {
    const { messages: m } = useI18n();
    const d = m.design;
    const [search, setSearch] = useState('');
    const [picked, setPicked] = useState<string[]>(selected);
    const term = useDebounced(search.trim(), 250);
    const results = useQuery({
        queryKey: ['designProductSearch', term],
        enabled: open,
        queryFn: () => searchProducts(term),
    });
    const single = max === 1;
    const toggle = (id: string) => {
        if (single) {
            onDone([id]);
            onClose();
            return;
        }
        setPicked(list =>
            list.includes(id) ? list.filter(item => item !== id) : list.length < max ? [...list, id] : list,
        );
    };
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={single ? d.chooseProduct : d.chooseProducts}
            footer={
                !single && (
                    <>
                        <span className="mr-auto self-center text-sm text-ink-muted">
                            {d.blockCount(String(picked.length), String(max))}
                        </span>
                        <Button variant="secondary" onClick={onClose}>
                            {m.common.cancel}
                        </Button>
                        <Button
                            onClick={() => {
                                onDone(picked);
                                onClose();
                            }}
                        >
                            {d.done}
                        </Button>
                    </>
                )
            }
        >
            <div className="relative mb-3">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                    aria-hidden
                />
                <Input
                    autoFocus
                    className="pl-9"
                    value={search}
                    placeholder={d.searchProducts}
                    aria-label={d.searchProducts}
                    onChange={event => setSearch(event.target.value)}
                />
            </div>
            <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
                {results.data?.length === 0 && (
                    <li className="px-3 py-6 text-center text-sm text-ink-muted">{d.noProductsFound}</li>
                )}
                {results.data?.map(product => {
                    const on = picked.includes(product.id);
                    return (
                        <li key={product.id}>
                            <button
                                type="button"
                                onClick={() => toggle(product.id)}
                                aria-pressed={single ? undefined : on}
                                className={cn(
                                    'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted',
                                    on && 'bg-accent-soft hover:bg-accent-soft',
                                )}
                            >
                                <ProductThumb product={product} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{product.name}</span>
                                    {!product.enabled && (
                                        <span className="text-xs text-warn">{d.hiddenProduct}</span>
                                    )}
                                </span>
                                {on && <Check className="size-5 text-accent" aria-hidden />}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </Dialog>
    );
}

/** Pick one category, or several (in the order picked). */
export function CollectionPickerDialog({
    open,
    onClose,
    selected,
    max,
    onDone,
}: {
    open: boolean;
    onClose(): void;
    selected: string[];
    max: number;
    onDone(ids: string[]): void;
}) {
    const { messages: m } = useI18n();
    const d = m.design;
    const collections = useCollections();
    const [filter, setFilter] = useState('');
    const [picked, setPicked] = useState<string[]>(selected);
    const single = max === 1;
    const shown = useMemo(() => {
        const text = filter.trim().toLowerCase();
        return (collections.data ?? []).filter(
            item => !item.isPrivate && collectionLabel(item).toLowerCase().includes(text),
        );
    }, [collections.data, filter]);
    const toggle = (id: string) => {
        if (single) {
            onDone([id]);
            onClose();
            return;
        }
        setPicked(list =>
            list.includes(id) ? list.filter(item => item !== id) : list.length < max ? [...list, id] : list,
        );
    };
    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={d.chooseCategory}
            footer={
                !single && (
                    <>
                        <span className="mr-auto self-center text-sm text-ink-muted">
                            {d.blockCount(String(picked.length), String(max))}
                        </span>
                        <Button variant="secondary" onClick={onClose}>
                            {m.common.cancel}
                        </Button>
                        <Button
                            onClick={() => {
                                onDone(picked);
                                onClose();
                            }}
                        >
                            {d.done}
                        </Button>
                    </>
                )
            }
        >
            <Input
                className="mb-3"
                value={filter}
                placeholder={d.chooseCategory}
                aria-label={d.chooseCategory}
                onChange={event => setFilter(event.target.value)}
            />
            {collections.data && shown.length === 0 && (
                <p className="py-6 text-center text-sm text-ink-muted">{d.noCategories}</p>
            )}
            <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
                {shown.map(collection => {
                    const on = picked.includes(collection.id);
                    const order = picked.indexOf(collection.id);
                    return (
                        <li key={collection.id}>
                            <button
                                type="button"
                                onClick={() => toggle(collection.id)}
                                aria-pressed={single ? undefined : on}
                                className={cn(
                                    'flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-muted',
                                    on && 'bg-accent-soft hover:bg-accent-soft',
                                )}
                            >
                                <span className="min-w-0 flex-1 truncate">
                                    {collection.path.slice(0, -1).map(part => (
                                        <span key={part} className="text-ink-muted">
                                            {part} /{' '}
                                        </span>
                                    ))}
                                    {collection.name}
                                </span>
                                {on && !single && (
                                    <span className="flex size-6 items-center justify-center rounded bg-accent text-xs font-semibold text-white">
                                        {order + 1}
                                    </span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </Dialog>
    );
}
