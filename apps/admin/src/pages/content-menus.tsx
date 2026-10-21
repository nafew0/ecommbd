import type { MenuItem, MenuLink, Menus } from '@ecommbd/shared/content';
import { CONTENT_LIMITS } from '@ecommbd/shared/content';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CornerDownRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Input, Select } from '../components/ui/input';
import { Card, CardBody, CardHeader, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { errorMap } from '../lib/form';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';
import { type ContentPage, pick } from './content-pages';

type Location = 'header' | 'footer';
type LinkType = MenuLink['type'];
interface Child {
    label: { bn: string; en: string };
    link: MenuLink;
}

const LINK_TYPES: LinkType[] = ['category', 'product', 'page', 'policy', 'url'];
const POLICIES = ['returnPolicy', 'refundPolicy', 'privacyPolicy', 'terms'] as const;

function emptyLink(type: LinkType): MenuLink {
    switch (type) {
        case 'policy':
            return { type, policy: 'returnPolicy' };
        case 'url':
            return { type, url: '' };
        default:
            return { type, id: '' };
    }
}

const newItem = (): MenuItem => ({ label: { bn: '', en: '' }, link: emptyLink('category'), children: [] });

function move<T>(list: T[], index: number, by: number): T[] {
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item!);
    return next;
}

interface Targets {
    categories: Array<{ id: string; name: string }>;
    products: Array<{ id: string; name: string }>;
    pages: ContentPage[];
}

const TARGETS = `{
    collections(options: { take: 100, sort: { name: ASC } }) { items { id name } }
    products(options: { take: 100, sort: { name: ASC } }) { items { id name } }
    bdPages(take: 100) { items { id enabled updatedAt translations { languageCode title slug body seoTitle seoDescription } } }
}`;

/** Online store → Menus (roadmap phase 12): the header and footer links, two levels deep. */
export function ContentMenusPage() {
    const { messages: m, language } = useI18n();
    const c = m.content;
    const toast = useToast();
    const queryClient = useQueryClient();
    const menus = useQuery({
        queryKey: ['contentMenus'],
        queryFn: () => adminApi<{ bdMenus: Menus }>('{ bdMenus }').then(result => result.bdMenus),
    });
    const targets = useQuery({
        queryKey: ['menuTargets'],
        queryFn: () =>
            adminApi<{
                collections: { items: Targets['categories'] };
                products: { items: Targets['products'] };
                bdPages: { items: ContentPage[] };
            }>(TARGETS).then(result => ({
                categories: result.collections.items,
                products: result.products.items,
                pages: result.bdPages.items,
            })),
    });
    const [draft, setDraft] = useState<Menus | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        if (menus.data && !draft) setDraft(menus.data);
    }, [menus.data, draft]);
    const save = useMutation({
        mutationFn: (input: Menus) =>
            adminApi<{
                updateBdMenus: { menus: Menus | null; errors: Array<{ path: string; code: string }> };
            }>(`mutation ($input: JSON!) { updateBdMenus(input: $input) { menus errors { path code } } }`, {
                input,
            }).then(result => result.updateBdMenus),
        onSuccess: result => {
            setErrors(errorMap(result.errors));
            if (result.menus) {
                toast.success(c.menusSaved);
                void queryClient.invalidateQueries({ queryKey: ['contentMenus'] });
            } else {
                toast.error(m.settings.fixErrors);
            }
        },
        onError: () => toast.error(m.errors.generic),
    });

    if (!draft || !targets.data) return <PageSkeleton />;
    const options = targets.data;

    const update = (location: Location, items: MenuItem[]) => setDraft({ ...draft, [location]: items });

    const linkTarget = (link: MenuLink, path: string, onChange: (link: MenuLink) => void) => {
        if (link.type === 'url') {
            return (
                <Field label={c.url} hint={c.urlHint} error={errors[`${path}.link.url`]}>
                    {control => (
                        <Input
                            {...control}
                            value={link.url}
                            maxLength={CONTENT_LIMITS.url}
                            inputMode="url"
                            onChange={event => onChange({ type: 'url', url: event.target.value })}
                        />
                    )}
                </Field>
            );
        }
        if (link.type === 'policy') {
            return (
                <Field label={c.linkTypes.policy}>
                    {control => (
                        <Select
                            {...control}
                            value={link.policy}
                            onChange={event =>
                                onChange({
                                    type: 'policy',
                                    policy: event.target.value as (typeof POLICIES)[number],
                                })
                            }
                        >
                            {POLICIES.map(policy => (
                                <option key={policy} value={policy}>
                                    {c.policies[policy]}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
            );
        }
        const list =
            link.type === 'category'
                ? options.categories
                : link.type === 'product'
                  ? options.products
                  : options.pages.map(page => ({
                        id: page.id,
                        name: pick(page, language)?.title ?? page.id,
                    }));
        return (
            <Field label={c.linkTypes[link.type]} error={errors[`${path}.link.id`]}>
                {control => (
                    <Select
                        {...control}
                        value={link.id}
                        onChange={event => onChange({ type: link.type, id: event.target.value } as MenuLink)}
                    >
                        <option value="">{c.choose}</option>
                        {list.map(item => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </Select>
                )}
            </Field>
        );
    };

    const row = (item: Child, path: string, onChange: (item: Child) => void, tools: React.ReactNode) => (
        <div className="space-y-3 rounded-md border border-slate-200 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
                <Field label={c.labelBn} error={errors[`${path}.label`]}>
                    {control => (
                        <Input
                            {...control}
                            lang="bn"
                            value={item.label.bn}
                            maxLength={CONTENT_LIMITS.menuLabel}
                            onChange={event =>
                                onChange({ ...item, label: { ...item.label, bn: event.target.value } })
                            }
                        />
                    )}
                </Field>
                <Field label={c.labelEn}>
                    {control => (
                        <Input
                            {...control}
                            lang="en"
                            value={item.label.en}
                            maxLength={CONTENT_LIMITS.menuLabel}
                            onChange={event =>
                                onChange({ ...item, label: { ...item.label, en: event.target.value } })
                            }
                        />
                    )}
                </Field>
                <Field label={c.linkTo}>
                    {control => (
                        <Select
                            {...control}
                            value={item.link.type}
                            onChange={event =>
                                onChange({ ...item, link: emptyLink(event.target.value as LinkType) })
                            }
                        >
                            {LINK_TYPES.map(type => (
                                <option key={type} value={type}>
                                    {c.linkTypes[type]}
                                </option>
                            ))}
                        </Select>
                    )}
                </Field>
                {linkTarget(item.link, path, link => onChange({ ...item, link }))}
            </div>
            <div className="flex flex-wrap gap-2">{tools}</div>
        </div>
    );

    const iconButton = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
        <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
        >
            {icon}
        </Button>
    );

    const section = (location: Location) => {
        const items = draft[location];
        return (
            <Card key={location} aria-label={location === 'header' ? c.header : c.footer}>
                <CardHeader
                    title={location === 'header' ? c.header : c.footer}
                    description={location === 'header' ? c.headerHint : undefined}
                />
                <CardBody>
                    {items.map((item, index) => (
                        <div key={index} className="space-y-2">
                            {row(
                                item,
                                `${location}.${index}`,
                                next =>
                                    update(
                                        location,
                                        items.map((other, i) => (i === index ? { ...item, ...next } : other)),
                                    ),
                                <>
                                    {iconButton(
                                        c.moveUp,
                                        <ArrowUp className="size-4" aria-hidden />,
                                        () => update(location, move(items, index, -1)),
                                        index === 0,
                                    )}
                                    {iconButton(
                                        c.moveDown,
                                        <ArrowDown className="size-4" aria-hidden />,
                                        () => update(location, move(items, index, 1)),
                                        index === items.length - 1,
                                    )}
                                    {location === 'header' && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                update(
                                                    location,
                                                    items.map((other, i) =>
                                                        i === index
                                                            ? {
                                                                  ...item,
                                                                  children: [
                                                                      ...item.children,
                                                                      {
                                                                          label: { bn: '', en: '' },
                                                                          link: emptyLink('category'),
                                                                      },
                                                                  ],
                                                              }
                                                            : other,
                                                    ),
                                                )
                                            }
                                        >
                                            <CornerDownRight className="size-4" aria-hidden />
                                            {c.addChild}
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                            update(
                                                location,
                                                items.filter((_, i) => i !== index),
                                            )
                                        }
                                    >
                                        <Trash2 className="size-4" aria-hidden />
                                        {c.remove}
                                    </Button>
                                </>,
                            )}
                            {item.children.length > 0 && (
                                <div className="space-y-2 border-l-2 border-slate-200 pl-4 sm:ml-6">
                                    {item.children.map((child, childIndex) => {
                                        const setChildren = (children: Child[]) =>
                                            update(
                                                location,
                                                items.map((other, i) =>
                                                    i === index ? { ...item, children } : other,
                                                ),
                                            );
                                        return (
                                            <div key={childIndex}>
                                                {row(
                                                    child,
                                                    `${location}.${index}.children.${childIndex}`,
                                                    next =>
                                                        setChildren(
                                                            item.children.map((other, i) =>
                                                                i === childIndex ? next : other,
                                                            ),
                                                        ),
                                                    <>
                                                        {iconButton(
                                                            c.moveUp,
                                                            <ArrowUp className="size-4" aria-hidden />,
                                                            () =>
                                                                setChildren(
                                                                    move(item.children, childIndex, -1),
                                                                ),
                                                            childIndex === 0,
                                                        )}
                                                        {iconButton(
                                                            c.moveDown,
                                                            <ArrowDown className="size-4" aria-hidden />,
                                                            () =>
                                                                setChildren(
                                                                    move(item.children, childIndex, 1),
                                                                ),
                                                            childIndex === item.children.length - 1,
                                                        )}
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() =>
                                                                setChildren(
                                                                    item.children.filter(
                                                                        (_, i) => i !== childIndex,
                                                                    ),
                                                                )
                                                            }
                                                        >
                                                            <Trash2 className="size-4" aria-hidden />
                                                            {c.remove}
                                                        </Button>
                                                    </>,
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))}
                    <Button
                        variant="secondary"
                        onClick={() => update(location, [...items, newItem()])}
                        disabled={items.length >= CONTENT_LIMITS.menuItems}
                    >
                        <Plus className="size-4" aria-hidden />
                        {c.addItem}
                    </Button>
                </CardBody>
            </Card>
        );
    };

    return (
        <>
            <PageHeader title={c.menusTitle} description={c.menusDescription} />
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault();
                    save.mutate(draft);
                }}
            >
                {section('header')}
                {section('footer')}
                <Button type="submit" loading={save.isPending}>
                    {m.settings.save}
                </Button>
            </form>
        </>
    );
}
