import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/form/field';
import { ImageUpload } from '../components/form/image-upload';
import { useDigits } from '../components/form/inputs';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Badge, Card, CardBody, EmptyState, PageHeader, PageSkeleton } from '../components/ui/misc';
import { Switch } from '../components/ui/switch';
import { adminApi, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useConfirm } from '../lib/confirm';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

const FIELDS = `id name { bn en } preview assetId parentId position productCount freeDelivery`;
const LIST = `{ bdCategories { ${FIELDS} } }`;
const SAVE = `mutation Save($input: BdSaveCategoryInput!) { saveBdCategory(input: $input) { ${FIELDS} } }`;
const MOVE = `mutation Move($id: ID!, $index: Int!) { moveBdCategory(id: $id, index: $index) { id } }`;
const DELETE = `mutation Delete($id: ID!) { deleteBdCategory(id: $id) }`;

interface Category {
    id: string;
    name: { bn: string; en: string };
    preview: string | null;
    assetId: string | null;
    parentId: string | null;
    position: number;
    productCount: number;
    freeDelivery: boolean;
}

interface Draft {
    id: string | null;
    name: { bn: string; en: string };
    image: { id: string; preview: string } | null;
    parentId: string;
    freeDelivery: boolean;
}

/** Categories (roadmap phase 05): names in both languages, image, parent, order, free delivery. */
export function CategoriesPage() {
    const { messages: m, language } = useI18n();
    const c = m.categories;
    const { can } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();
    const digits = useDigits();
    const queryClient = useQueryClient();
    const canEdit = can('UpdateCollection') || can('UpdateCatalog');
    const query = useQuery({
        queryKey: ['categories'],
        queryFn: () => adminApi<{ bdCategories: Category[] }>(LIST).then(r => r.bdCategories),
    });
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['categories'] });
    const nameOf = (category: Category) => category.name[language] || category.name.bn || category.name.en;

    if (query.isPending) return <PageSkeleton />;
    const categories = query.data ?? [];
    // Parents first, each followed by its children: the order shoppers see in menus.
    const top = categories.filter(category => !category.parentId);
    const ordered = top.flatMap(parent => [
        parent,
        ...categories.filter(child => child.parentId === parent.id),
    ]);

    const save = async () => {
        if (!draft) return;
        setBusy(true);
        try {
            await adminApi(SAVE, {
                input: {
                    id: draft.id,
                    name: draft.name,
                    assetId: draft.image?.id ?? null,
                    parentId: draft.parentId || null,
                    freeDelivery: draft.freeDelivery,
                },
            });
            toast.success(c.saved);
            setDraft(null);
            refresh();
        } catch (error) {
            toast.error(error instanceof ApiError ? error.message : m.errors.generic);
        } finally {
            setBusy(false);
        }
    };

    const move = async (category: Category, by: number) => {
        const siblings = categories.filter(other => other.parentId === category.parentId);
        const index = siblings.findIndex(other => other.id === category.id) + by;
        if (index < 0 || index >= siblings.length) return;
        await adminApi(MOVE, { id: category.id, index }).catch(() => toast.error(m.errors.generic));
        refresh();
    };

    const remove = async (category: Category) => {
        if (
            !(await confirm({
                title: c.deleteTitle(nameOf(category)),
                body: c.deleteBody,
                confirmLabel: m.common.delete,
                danger: true,
            }))
        ) {
            return;
        }
        await adminApi(DELETE, { id: category.id }).then(
            () => toast.success(c.deleted),
            () => toast.error(m.errors.generic),
        );
        refresh();
    };

    return (
        <>
            <PageHeader
                title={c.title}
                description={c.description}
                actions={
                    canEdit && (
                        <Button
                            onClick={() =>
                                setDraft({
                                    id: null,
                                    name: { bn: '', en: '' },
                                    image: null,
                                    parentId: '',
                                    freeDelivery: false,
                                })
                            }
                        >
                            <Plus className="size-4" aria-hidden /> {c.add}
                        </Button>
                    )
                }
            />
            {ordered.length === 0 ? (
                <EmptyState icon={<FolderTree className="size-6" aria-hidden />} title={c.empty} body="" />
            ) : (
                <Card>
                    <CardBody className="p-0 sm:p-0">
                        <ul className="divide-y divide-slate-100">
                            {ordered.map(category => (
                                <li
                                    key={category.id}
                                    className={`flex items-center gap-3 px-4 py-3 ${category.parentId ? 'pl-10' : ''}`}
                                >
                                    {category.preview ? (
                                        <img
                                            src={`${category.preview}?preset=tiny`}
                                            alt=""
                                            className="size-10 rounded object-cover"
                                        />
                                    ) : (
                                        <div className="size-10 rounded bg-slate-100" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium">{nameOf(category)}</p>
                                        <p className="text-sm text-slate-600">
                                            {c.products(digits(category.productCount))}
                                            {category.freeDelivery && (
                                                <Badge tone="green" className="ml-2">
                                                    {c.freeDelivery}
                                                </Badge>
                                            )}
                                        </p>
                                    </div>
                                    {canEdit && (
                                        <div className="flex gap-1">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                aria-label={c.up}
                                                onClick={() => void move(category, -1)}
                                            >
                                                <ArrowUp className="size-4" aria-hidden />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                aria-label={c.down}
                                                onClick={() => void move(category, 1)}
                                            >
                                                <ArrowDown className="size-4" aria-hidden />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                aria-label={c.edit}
                                                onClick={() =>
                                                    setDraft({
                                                        id: category.id,
                                                        name: category.name,
                                                        image:
                                                            category.assetId && category.preview
                                                                ? {
                                                                      id: category.assetId,
                                                                      preview: category.preview,
                                                                  }
                                                                : null,
                                                        parentId: category.parentId ?? '',
                                                        freeDelivery: category.freeDelivery,
                                                    })
                                                }
                                            >
                                                <Pencil className="size-4" aria-hidden />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                aria-label={m.common.delete}
                                                onClick={() => void remove(category)}
                                            >
                                                <Trash2 className="size-4 text-red-700" aria-hidden />
                                            </Button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </CardBody>
                </Card>
            )}
            <Dialog
                open={!!draft}
                onClose={() => setDraft(null)}
                dismissible={!busy}
                title={draft?.id ? c.editTitle : c.newTitle}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setDraft(null)} disabled={busy}>
                            {m.common.cancel}
                        </Button>
                        <Button
                            loading={busy}
                            disabled={!draft?.name.bn.trim() && !draft?.name.en.trim()}
                            onClick={() => void save()}
                        >
                            {m.common.save}
                        </Button>
                    </>
                }
            >
                {draft && (
                    <div className="space-y-4">
                        <Field label={c.nameBn}>
                            {control => (
                                <Input
                                    {...control}
                                    autoFocus
                                    maxLength={100}
                                    value={draft.name.bn}
                                    onChange={e =>
                                        setDraft({ ...draft, name: { ...draft.name, bn: e.target.value } })
                                    }
                                />
                            )}
                        </Field>
                        <Field label={c.nameEn} optional>
                            {control => (
                                <Input
                                    {...control}
                                    maxLength={100}
                                    value={draft.name.en}
                                    onChange={e =>
                                        setDraft({ ...draft, name: { ...draft.name, en: e.target.value } })
                                    }
                                />
                            )}
                        </Field>
                        <Field label={c.image} optional>
                            {control => (
                                <ImageUpload
                                    {...control}
                                    maxMegabytes={15}
                                    value={draft.image}
                                    onChange={image => setDraft({ ...draft, image })}
                                />
                            )}
                        </Field>
                        <Field label={c.parent} optional>
                            {control => (
                                <Select
                                    {...control}
                                    value={draft.parentId}
                                    onChange={e => setDraft({ ...draft, parentId: e.target.value })}
                                >
                                    <option value="">{c.noParent}</option>
                                    {top
                                        .filter(category => category.id !== draft.id)
                                        .map(category => (
                                            <option key={category.id} value={category.id}>
                                                {nameOf(category)}
                                            </option>
                                        ))}
                                </Select>
                            )}
                        </Field>
                        <Switch
                            label={c.freeDeliverySwitch}
                            description={c.freeDeliveryHint}
                            checked={draft.freeDelivery}
                            onChange={freeDelivery => setDraft({ ...draft, freeDelivery })}
                        />
                    </div>
                )}
            </Dialog>
        </>
    );
}
