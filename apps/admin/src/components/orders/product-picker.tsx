import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { adminApi } from '../../lib/api';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useDebounced } from '../../lib/use-debounced';
import { useDigits } from '../form/inputs';
import { Input } from '../ui/input';

const SEARCH = `
    query Pick($search: String) {
        bdStock(search: $search, take: 20) { variantId name sku preview available price backorder }
    }
`;

export interface PickedVariant {
    variantId: string;
    name: string;
    sku: string;
    preview: string | null;
    available: number;
    price: number;
    backorder: boolean;
}

/** Search products by name or SKU and pick a variant, seeing its price and stock (phase 05). */
export function ProductPicker({ onPick }: { onPick(variant: PickedVariant): void }) {
    const { messages: m } = useI18n();
    const format = useFormat();
    const digits = useDigits();
    const [search, setSearch] = useState('');
    const term = useDebounced(search.trim());
    const results = useQuery({
        queryKey: ['productPicker', term],
        enabled: term.length > 0,
        queryFn: () => adminApi<{ bdStock: PickedVariant[] }>(SEARCH, { search: term }).then(r => r.bdStock),
    });
    return (
        <div className="space-y-2">
            <div className="relative">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                    aria-hidden
                />
                <Input
                    className="pl-9"
                    value={search}
                    placeholder={m.phoneOrder.searchProducts}
                    aria-label={m.phoneOrder.searchProducts}
                    onChange={event => setSearch(event.target.value)}
                />
            </div>
            {term && results.data && (
                <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
                    {results.data.length === 0 && (
                        <li className="px-3 py-2 text-sm text-ink-muted">{m.phoneOrder.noProducts}</li>
                    )}
                    {results.data.map(variant => {
                        const soldOut = variant.available <= 0 && !variant.backorder;
                        return (
                            <li key={variant.variantId}>
                                <button
                                    type="button"
                                    disabled={soldOut}
                                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-muted disabled:opacity-50"
                                    onClick={() => {
                                        onPick(variant);
                                        setSearch('');
                                    }}
                                >
                                    {variant.preview ? (
                                        <img
                                            src={`${variant.preview}?preset=tiny`}
                                            alt=""
                                            className="size-10 rounded object-cover"
                                        />
                                    ) : (
                                        <span className="size-10 rounded bg-surface-muted" />
                                    )}
                                    <span className="min-w-0 flex-1">
                                        <span className="block font-medium">{variant.name}</span>
                                        <span className="block text-sm text-ink-muted">
                                            {format.money(variant.price)} ·{' '}
                                            {soldOut
                                                ? m.phoneOrder.soldOut
                                                : variant.backorder && variant.available <= 0
                                                  ? m.phoneOrder.preorder
                                                  : m.phoneOrder.inStock(digits(variant.available))}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
