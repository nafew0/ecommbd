import { Check, ChevronLeft, ChevronRight, Search, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
import { AnimatePresence, expand, m as motion } from '../lib/motion';
import { ActionMenu } from './ui/action-menu';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/misc';

export interface Column<T> {
    key: string;
    header: string;
    cell(row: T): ReactNode;
    className?: string;
    /** Hidden on phones, to keep the table readable without scrolling sideways. */
    hideOnMobile?: boolean;
}

export interface ListTab {
    key: string;
    label: string;
    count?: number;
}

interface ListPageProps<T> {
    rows: T[];
    rowId(row: T): string;
    columns: Column<T>[];
    loading?: boolean;
    search?: { value: string; onChange(value: string): void; placeholder?: string };
    /** Status tabs with counts (All, New, Confirmed…). */
    tabs?: {
        items: ListTab[];
        active: string;
        onChange(key: string): void;
        /** Keys of the rarely used tabs: they sit under one "Others" menu at the end. */
        more?: string[];
    };
    /**
     * Lets each person choose which columns to see; remembered on this device under `storageKey`.
     * `locked` columns can't be hidden (the one that names the row).
     */
    columnPicker?: { storageKey: string; locked?: string[] };
    /** Filters used all the time, shown beside the search box. Keep to one or two. */
    filters?: ReactNode;
    /** The rest, behind one "Filters" button. `active` is how many are set (shown on the button). */
    moreFilters?: { content: ReactNode; active: number };
    pagination?: {
        page: number;
        pageSize: number;
        total: number;
        onChange(page: number): void;
        /** Offers a "per page" choice beside the page buttons (the packing desk picks 100). */
        sizes?: number[];
        onSizeChange?(size: number): void;
    };
    selection?: { selected: ReadonlySet<string>; onChange(selected: Set<string>): void; actions?: ReactNode };
    empty: ReactNode;
}

function readHidden(storageKey: string | undefined): string[] {
    if (!storageKey) return [];
    try {
        const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
        return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * The list screen every later phase uses (orders, products, customers…): search, status tabs with
 * counts, filters, pagination and bulk select. Data loading stays with the page.
 */
export function ListPage<T>(props: ListPageProps<T>) {
    const { messages: m } = useI18n();
    const { rows, rowId, loading, search, tabs, filters, moreFilters, pagination, selection, empty } = props;
    const { columnPicker } = props;
    const [hidden, setHidden] = useState<string[]>(() => readHidden(columnPicker?.storageKey));
    const columns = props.columns.filter(column => !hidden.includes(column.key));
    const toggleColumn = (key: string) => {
        setHidden(current => {
            const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
            try {
                if (columnPicker) localStorage.setItem(columnPicker.storageKey, JSON.stringify(next));
            } catch {
                // Not remembered: fine.
            }
            return next;
        });
    };
    const moreKeys = tabs?.more ?? [];
    const mainTabs = tabs?.items.filter(tab => !moreKeys.includes(tab.key)) ?? [];
    const moreTabs = tabs?.items.filter(tab => moreKeys.includes(tab.key)) ?? [];
    const activeMore = moreTabs.find(tab => tab.key === tabs?.active);
    const [filtersOpen, setFiltersOpen] = useState((moreFilters?.active ?? 0) > 0);
    const pageIds = rows.map(rowId);
    const allSelected =
        selection !== undefined && pageIds.length > 0 && pageIds.every(id => selection.selected.has(id));
    const toggle = (id: string) => {
        if (!selection) return;
        const next = new Set(selection.selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selection.onChange(next);
    };
    const toggleAll = () => {
        if (!selection) return;
        const next = new Set(selection.selected);
        pageIds.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
        selection.onChange(next);
    };
    const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
    const n = m.common.number;

    return (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {tabs && (
                <div className="flex gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
                    {mainTabs.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={tabs.active === tab.key}
                            onClick={() => tabs.onChange(tab.key)}
                            className={cn(
                                '-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                                tabs.active === tab.key
                                    ? 'border-ink font-semibold text-ink'
                                    : 'border-transparent text-ink-muted hover:text-ink',
                            )}
                        >
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className="rounded-md bg-surface-muted px-1.5 text-xs font-normal text-ink-muted tabular-nums">
                                    {n(tab.count)}
                                </span>
                            )}
                        </button>
                    ))}
                    {moreTabs.length > 0 && (
                        <ActionMenu
                            variant="ghost"
                            size="sm"
                            className={cn(
                                'my-1 shrink-0 self-center',
                                activeMore && 'bg-surface-muted font-semibold text-ink',
                            )}
                            label={
                                activeMore
                                    ? `${activeMore.label} ${n(activeMore.count ?? 0)}`
                                    : `${m.list.others} ${n(moreTabs.reduce((sum, tab) => sum + (tab.count ?? 0), 0))}`
                            }
                            items={moreTabs.map(tab => ({
                                label: tab.count === undefined ? tab.label : `${tab.label} · ${n(tab.count)}`,
                                onSelect: () => tabs.onChange(tab.key),
                            }))}
                        />
                    )}
                </div>
            )}
            {(search || filters || moreFilters || columnPicker) && (
                <div className="border-b border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {search && (
                            <div className="relative min-w-0 flex-1 basis-56">
                                <Search
                                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
                                    aria-hidden
                                />
                                <Input
                                    type="search"
                                    aria-label={search.placeholder ?? m.list.searchPlaceholder}
                                    placeholder={search.placeholder ?? m.list.searchPlaceholder}
                                    value={search.value}
                                    onChange={event => search.onChange(event.target.value)}
                                    className="pl-9"
                                />
                            </div>
                        )}
                        {filters}
                        {columnPicker && (
                            <ActionMenu
                                label={m.list.columns}
                                items={props.columns
                                    .filter(column => !columnPicker.locked?.includes(column.key))
                                    .map(column => ({
                                        label: column.header,
                                        icon: hidden.includes(column.key) ? (
                                            <span className="size-4" />
                                        ) : (
                                            <Check className="size-4" aria-hidden />
                                        ),
                                        onSelect: () => toggleColumn(column.key),
                                    }))}
                            />
                        )}
                        {moreFilters && (
                            <Button
                                variant="secondary"
                                aria-expanded={filtersOpen}
                                onClick={() => setFiltersOpen(value => !value)}
                            >
                                <SlidersHorizontal className="size-4" aria-hidden />
                                {m.common.filters}
                                {moreFilters.active > 0 && (
                                    <span className="rounded-md bg-accent-soft px-1.5 text-xs text-accent tabular-nums">
                                        {n(moreFilters.active)}
                                    </span>
                                )}
                            </Button>
                        )}
                    </div>
                    <AnimatePresence initial={false}>
                        {moreFilters && filtersOpen && (
                            <motion.div {...expand} className="overflow-hidden">
                                <div className="pt-3">{moreFilters.content}</div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            )}
            {selection && selection.selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft px-3 py-2 text-sm">
                    <span className="font-medium text-accent">
                        {m.list.selected(selection.selected.size)}
                    </span>
                    {selection.actions}
                    <button
                        type="button"
                        className="text-accent underline"
                        onClick={() => selection.onChange(new Set())}
                    >
                        {m.list.clearSelection}
                    </button>
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-surface-muted text-ink-muted">
                        <tr>
                            {selection && (
                                <th scope="col" className="w-10 px-3 py-2">
                                    <input
                                        type="checkbox"
                                        className="size-4 accent-accent"
                                        aria-label={m.list.selectAll}
                                        checked={allSelected}
                                        onChange={toggleAll}
                                    />
                                </th>
                            )}
                            {columns.map(column => (
                                <th
                                    key={column.key}
                                    scope="col"
                                    className={cn(
                                        'px-3 py-2.5 text-[13px] font-semibold',
                                        column.hideOnMobile && 'hidden sm:table-cell',
                                        column.className,
                                    )}
                                >
                                    {column.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                        {loading
                            ? Array.from({ length: 5 }, (_, index) => (
                                  <tr key={index}>
                                      <td
                                          colSpan={columns.length + (selection ? 1 : 0)}
                                          className="px-3 py-3"
                                      >
                                          <Skeleton className="h-5 w-full" />
                                      </td>
                                  </tr>
                              ))
                            : rows.map(row => {
                                  const id = rowId(row);
                                  return (
                                      <tr
                                          key={id}
                                          className={cn(selection?.selected.has(id) && 'bg-accent-soft/50')}
                                      >
                                          {selection && (
                                              <td className="px-3 py-2">
                                                  <input
                                                      type="checkbox"
                                                      className="size-4 accent-accent"
                                                      aria-label={m.list.selectRow}
                                                      checked={selection.selected.has(id)}
                                                      onChange={() => toggle(id)}
                                                  />
                                              </td>
                                          )}
                                          {columns.map(column => (
                                              <td
                                                  key={column.key}
                                                  className={cn(
                                                      'h-12 px-3 py-2',
                                                      column.hideOnMobile && 'hidden sm:table-cell',
                                                      column.className,
                                                  )}
                                              >
                                                  {column.cell(row)}
                                              </td>
                                          ))}
                                      </tr>
                                  );
                              })}
                    </tbody>
                </table>
            </div>
            {!loading && rows.length === 0 && empty}
            {pagination && pagination.total > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm text-ink-muted">
                    <span>
                        {m.list.showing(
                            (pagination.page - 1) * pagination.pageSize + 1,
                            Math.min(pagination.page * pagination.pageSize, pagination.total),
                            pagination.total,
                        )}
                    </span>
                    <div className="flex items-center gap-1">
                        {pagination.sizes && pagination.onSizeChange && (
                            <label className="mr-2 flex items-center gap-2">
                                <span>{m.list.perPage}</span>
                                <select
                                    value={pagination.pageSize}
                                    onChange={event => pagination.onSizeChange?.(Number(event.target.value))}
                                    className="min-h-9 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink focus:outline-2 focus:outline-accent"
                                >
                                    {pagination.sizes.map(size => (
                                        <option key={size} value={size}>
                                            {n(size)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <button
                            type="button"
                            className="rounded p-2 hover:bg-surface-muted disabled:opacity-40"
                            aria-label={m.list.previous}
                            disabled={pagination.page <= 1}
                            onClick={() => pagination.onChange(pagination.page - 1)}
                        >
                            <ChevronLeft className="size-4" aria-hidden />
                        </button>
                        <span>{m.list.pageOf(pagination.page, pages)}</span>
                        <button
                            type="button"
                            className="rounded p-2 hover:bg-surface-muted disabled:opacity-40"
                            aria-label={m.list.next}
                            disabled={pagination.page >= pages}
                            onClick={() => pagination.onChange(pagination.page + 1)}
                        >
                            <ChevronRight className="size-4" aria-hidden />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
