import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useI18n } from '../lib/i18n';
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
    tabs?: { items: ListTab[]; active: string; onChange(key: string): void };
    filters?: ReactNode;
    pagination?: { page: number; pageSize: number; total: number; onChange(page: number): void };
    selection?: { selected: ReadonlySet<string>; onChange(selected: Set<string>): void; actions?: ReactNode };
    empty: ReactNode;
}

/**
 * The list screen every later phase uses (orders, products, customers…): search, status tabs with
 * counts, filters, pagination and bulk select. Data loading stays with the page.
 */
export function ListPage<T>(props: ListPageProps<T>) {
    const { messages: m } = useI18n();
    const { rows, rowId, columns, loading, search, tabs, filters, pagination, selection, empty } = props;
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
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {tabs && (
                <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-2" role="tablist">
                    {tabs.items.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={tabs.active === tab.key}
                            onClick={() => tabs.onChange(tab.key)}
                            className={cn(
                                'flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap',
                                tabs.active === tab.key
                                    ? 'border-teal-700 text-teal-800'
                                    : 'border-transparent text-slate-600 hover:text-slate-900',
                            )}
                        >
                            {tab.label}
                            {tab.count !== undefined && (
                                <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-700">
                                    {n(tab.count)}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}
            {(search || filters) && (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
                    {search && (
                        <div className="relative min-w-0 flex-1 basis-56">
                            <Search
                                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
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
                </div>
            )}
            {selection && selection.selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-3 border-b border-teal-100 bg-teal-50 px-3 py-2 text-sm">
                    <span className="font-medium text-teal-900">
                        {m.list.selected(selection.selected.size)}
                    </span>
                    {selection.actions}
                    <button
                        type="button"
                        className="text-teal-800 underline"
                        onClick={() => selection.onChange(new Set())}
                    >
                        {m.list.clearSelection}
                    </button>
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                        <tr>
                            {selection && (
                                <th scope="col" className="w-10 px-3 py-2">
                                    <input
                                        type="checkbox"
                                        className="size-4 accent-teal-700"
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
                                        'px-3 py-2 font-medium',
                                        column.hideOnMobile && 'hidden sm:table-cell',
                                        column.className,
                                    )}
                                >
                                    {column.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
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
                                          className={cn(selection?.selected.has(id) && 'bg-teal-50/50')}
                                      >
                                          {selection && (
                                              <td className="px-3 py-2">
                                                  <input
                                                      type="checkbox"
                                                      className="size-4 accent-teal-700"
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
                                                      'px-3 py-2',
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
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-3 py-2 text-sm text-slate-600">
                    <span>
                        {m.list.showing(
                            (pagination.page - 1) * pagination.pageSize + 1,
                            Math.min(pagination.page * pagination.pageSize, pagination.total),
                            pagination.total,
                        )}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className="rounded p-2 hover:bg-slate-100 disabled:opacity-40"
                            aria-label={m.list.previous}
                            disabled={pagination.page <= 1}
                            onClick={() => pagination.onChange(pagination.page - 1)}
                        >
                            <ChevronLeft className="size-4" aria-hidden />
                        </button>
                        <span>{m.list.pageOf(pagination.page, pages)}</span>
                        <button
                            type="button"
                            className="rounded p-2 hover:bg-slate-100 disabled:opacity-40"
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
