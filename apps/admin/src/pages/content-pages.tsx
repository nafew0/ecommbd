import { useQuery } from '@tanstack/react-query';
import { FileText, Palette, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { type Column, ListPage } from '../components/list-page';
import { Badge, EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFormat } from '../lib/format';
import { useI18n } from '../lib/i18n';

export interface PageTranslation {
    languageCode: 'bn' | 'en';
    title: string;
    slug: string;
    body: string;
    seoTitle: string;
    seoDescription: string;
}

export interface ContentPage {
    id: string;
    enabled: boolean;
    updatedAt: string;
    translations: PageTranslation[];
}

export const PAGE_FIELDS = `id enabled updatedAt translations { languageCode title slug body seoTitle seoDescription }`;

/** The page's text in the admin's language, or the other one. */
export function pick(page: ContentPage, language: 'bn' | 'en'): PageTranslation | undefined {
    return page.translations.find(t => t.languageCode === language) ?? page.translations[0];
}

/** Online store → Pages (roadmap phase 12). */
export function ContentPagesPage() {
    const { messages: m, language } = useI18n();
    const c = m.content;
    const format = useFormat();
    const { can } = useAuth();
    const query = useQuery({
        queryKey: ['contentPages'],
        queryFn: () =>
            adminApi<{ bdPages: { items: ContentPage[]; totalItems: number } }>(
                `{ bdPages(take: 100) { totalItems items { ${PAGE_FIELDS} } } }`,
            ).then(result => result.bdPages),
    });
    const columns: Column<ContentPage>[] = [
        {
            key: 'title',
            header: c.columns.title,
            cell: page => (
                <Link to={`/store/pages/${page.id}`} className="font-medium text-teal-800 hover:underline">
                    {pick(page, language)?.title}
                </Link>
            ),
        },
        {
            key: 'address',
            header: c.columns.address,
            hideOnMobile: true,
            cell: page => (
                <span className="text-slate-600">/{pick(page, language)?.slug.normalize('NFC')}/</span>
            ),
        },
        {
            key: 'status',
            header: c.columns.status,
            cell: page =>
                page.enabled ? <Badge tone="green">{c.shown}</Badge> : <Badge tone="slate">{c.hidden}</Badge>,
        },
        {
            key: 'updated',
            header: c.columns.updated,
            hideOnMobile: true,
            cell: page => format.dateTime(page.updatedAt),
        },
        // Sections below the page's text (phase 15).
        ...(can('EditStorefront')
            ? [
                  {
                      key: 'sections',
                      header: m.design.sections,
                      cell: (page: ContentPage) => (
                          <Link
                              to={`/store/design/page/${page.id}`}
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-800 hover:underline"
                          >
                              <Palette className="size-4" aria-hidden />
                              {m.design.editSections}
                          </Link>
                      ),
                  },
              ]
            : []),
    ];
    const newPage = (
        <Link
            to="/store/pages/new"
            className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800"
        >
            <Plus className="size-4" aria-hidden />
            {c.newPage}
        </Link>
    );
    return (
        <>
            <PageHeader title={c.pagesTitle} description={c.pagesDescription} actions={newPage} />
            <ListPage
                rows={query.data?.items ?? []}
                rowId={page => page.id}
                columns={columns}
                loading={query.isPending}
                empty={
                    <EmptyState
                        icon={<FileText className="size-6" aria-hidden />}
                        title={c.noPages}
                        body={c.noPagesBody}
                        action={newPage}
                    />
                }
            />
        </>
    );
}
