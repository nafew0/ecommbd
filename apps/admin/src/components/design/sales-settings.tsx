import {
    type Bilingual,
    field,
    FONT_INFO,
    FONTS,
    pick,
    SALES_LIMITS,
    type SalesPageSettings,
    toSalesSlug,
} from '@ecommbd/sections';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useFormat } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useToast } from '../../lib/toast';
import { ImageUpload } from '../form/image-upload';
import { Button } from '../ui/button';
import { Input, Select, Textarea } from '../ui/input';
import { Switch } from '../ui/switch';
import {
    fetchVariant,
    fetchVariants,
    type SalesPage,
    type SalesPageProblem,
    updateSalesPage,
} from './design-api';
import { FieldControl, type Language, Segmented } from './field-controls';
import { IconButton } from './icon-button';
import { ProductPickerDialog, ProductThumb, useProducts } from './pickers';

/**
 * A sales page's own settings (roadmap phase 16), beside its sections in the page editor: its name
 * and address, product, the page around the sections (header, footer, width, colours, font), the
 * packs and add-on offer, the thank-you page and search engines. Saved with one button; the
 * preview then reloads.
 */

const hexField = (label: Bilingual) => field.hex(label);

export function SalesSettingsPanel({
    page,
    language,
    onSaved,
}: {
    page: SalesPage;
    /** The language being written (the editor's toolbar). */
    language: Language;
    onSaved(page: SalesPage): void;
}) {
    const { messages: m, language: ui } = useI18n();
    const t = m.salesPages;
    const toast = useToast();
    const format = useFormat();
    const queryClient = useQueryClient();
    const [title, setTitle] = useState(page.title);
    const [slug, setSlug] = useState(page.slug);
    const [active, setActive] = useState(page.active);
    const [productId, setProductId] = useState(page.productId);
    const [settings, setSettings] = useState<SalesPageSettings>(page.settings);
    const [errors, setErrors] = useState<SalesPageProblem[]>([]);
    const [saving, setSaving] = useState(false);
    const [picking, setPicking] = useState<null | 'product' | 'bump'>(null);
    const ids = useId();
    const products = useProducts(productId ? [productId] : []);
    const product = productId ? products.data?.get(productId) : undefined;
    const variants = useQuery({
        queryKey: ['salesVariants', productId],
        queryFn: () => fetchVariants(productId!),
        enabled: !!productId,
    });
    const unitPrice = Math.min(...(variants.data ?? []).map(variant => variant.priceWithTax), Infinity);
    const bumpVariant = useQuery({
        queryKey: ['salesVariant', settings.bump.variantId],
        queryFn: () => fetchVariant(settings.bump.variantId!),
        enabled: !!settings.bump.variantId,
    });
    const bumpProductId = bumpVariant.data?.product.id;
    const bumpVariants = useQuery({
        queryKey: ['salesVariants', bumpProductId],
        queryFn: () => fetchVariants(bumpProductId!),
        enabled: !!bumpProductId,
    });

    const set = (patch: Partial<SalesPageSettings>) => setSettings(current => ({ ...current, ...patch }));
    const text = (value: Bilingual, next: string): Bilingual => ({ ...value, [language]: next });
    const errorFor = (path: string) => {
        const error = errors.find(item => item.field === path || item.field.startsWith(`${path}.`));
        return error ? (t.problems[error.code] ?? error.code) : undefined;
    };
    const taka = (poisha: number | null) => (poisha == null ? '' : String(poisha / 100));
    const toPoisha = (value: string) => {
        const digits = value.replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/\D/g, '');
        return digits ? Math.min(Number(digits), SALES_LIMITS.maxPrice / 100) * 100 : 0;
    };

    const save = async () => {
        setSaving(true);
        try {
            const result = await updateSalesPage(page.id, {
                title,
                slug,
                active,
                ...(productId && productId !== page.productId ? { productId } : {}),
                settings,
            });
            setErrors(result.errors);
            if (result.page) {
                toast.success(t.saved);
                setSlug(result.page.slug);
                setSettings(result.page.settings);
                void queryClient.invalidateQueries({ queryKey: ['salesPages'] });
                onSaved(result.page);
            } else {
                toast.error(t.fixErrors);
            }
        } catch {
            toast.error(m.errors.generic);
        } finally {
            setSaving(false);
        }
    };

    const slugProblem = errors.find(error => error.field === 'slug');

    return (
        <div className="space-y-7 p-4">
            <Group title={t.basics}>
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
                        onChange={event => setTitle(event.target.value)}
                        aria-invalid={errorFor('title') ? true : undefined}
                    />
                    {errorFor('title') && <Problem>{errorFor('title')!}</Problem>}
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
                            value={slug}
                            maxLength={SALES_LIMITS.slug}
                            aria-invalid={slugProblem ? true : undefined}
                            onChange={event => setSlug(event.target.value)}
                            onBlur={() => setSlug(toSalesSlug(slug) || page.slug)}
                        />
                    </div>
                    {slugProblem && (
                        <Problem>
                            {t.problems[slugProblem.code] ?? slugProblem.code}
                            {slugProblem.suggestion && (
                                <button
                                    type="button"
                                    className="ml-1 font-medium text-teal-800 underline"
                                    onClick={() => setSlug(slugProblem.suggestion!)}
                                >
                                    {t.useSuggestion(slugProblem.suggestion)}
                                </button>
                            )}
                        </Problem>
                    )}
                </div>
                <Switch
                    checked={active}
                    onChange={setActive}
                    label={t.activeLabel}
                    description={t.activeHint}
                />
                <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-800">{t.product}</p>
                    <div className="flex items-center gap-2">
                        <ProductThumb product={product} size="size-10" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                            {product?.name ?? (productId ? '…' : t.noProduct)}
                        </span>
                        <Button variant="secondary" size="sm" onClick={() => setPicking('product')}>
                            {m.design.change}
                        </Button>
                    </div>
                    {errorFor('productId') && <Problem>{errorFor('productId')!}</Problem>}
                </div>
            </Group>

            <Group title={t.packs} hint={t.packsHint}>
                {settings.packs.length > 0 && (
                    <ul className="space-y-2">
                        {settings.packs.map((pack, index) => {
                            const normal = Number.isFinite(unitPrice) ? unitPrice * pack.quantity : null;
                            const saves = normal != null && normal > pack.price ? normal - pack.price : 0;
                            const update = (patch: Partial<typeof pack>) =>
                                set({
                                    packs: settings.packs.map((item, at) =>
                                        at === index
                                            ? { ...item, ...patch }
                                            : patch.popular
                                              ? { ...item, popular: false }
                                              : item,
                                    ),
                                });
                            return (
                                <li key={index} className="rounded-md border border-slate-200 p-3">
                                    <div className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
                                        <label className="text-xs font-medium text-slate-700">
                                            {t.quantity}
                                            <Input
                                                inputMode="numeric"
                                                value={String(pack.quantity)}
                                                onChange={event =>
                                                    update({
                                                        quantity: Math.min(
                                                            Number(event.target.value.replace(/\D/g, '')) ||
                                                                0,
                                                            SALES_LIMITS.packQuantity,
                                                        ),
                                                    })
                                                }
                                                aria-invalid={
                                                    errorFor(`settings.packs.${index}.quantity`)
                                                        ? true
                                                        : undefined
                                                }
                                            />
                                        </label>
                                        <label className="text-xs font-medium text-slate-700">
                                            {t.packPrice}
                                            <div className="flex min-h-11 items-center rounded-md border border-slate-300 bg-white focus-within:outline-2 focus-within:outline-teal-600">
                                                <span className="pl-3 text-slate-500" aria-hidden>
                                                    ৳
                                                </span>
                                                <input
                                                    inputMode="numeric"
                                                    className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-1 text-base outline-none"
                                                    value={taka(pack.price)}
                                                    onChange={event =>
                                                        update({ price: toPoisha(event.target.value) })
                                                    }
                                                />
                                            </div>
                                        </label>
                                        <IconButton
                                            tone="danger"
                                            aria-label={m.design.remove}
                                            onClick={() =>
                                                set({ packs: settings.packs.filter((_, at) => at !== index) })
                                            }
                                        >
                                            <Trash2 className="size-4" aria-hidden />
                                        </IconButton>
                                    </div>
                                    <p className="mt-1.5 text-xs text-slate-600">
                                        {normal != null &&
                                            (saves
                                                ? t.packSaves(format.money(normal), format.money(saves))
                                                : t.packNoSaving(format.money(normal)))}
                                    </p>
                                    <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
                                        <Input
                                            aria-label={t.packLabel}
                                            lang={language}
                                            value={pack.label[language]}
                                            placeholder={t.packLabelPlaceholder}
                                            maxLength={SALES_LIMITS.label}
                                            onChange={event =>
                                                update({ label: text(pack.label, event.target.value) })
                                            }
                                        />
                                        <label className="flex items-center gap-1.5 text-sm">
                                            <input
                                                type="radio"
                                                name={`${ids}-popular`}
                                                checked={pack.popular}
                                                onChange={() => update({ popular: true })}
                                                className="size-4 accent-teal-700"
                                            />
                                            {t.popular}
                                        </label>
                                    </div>
                                    {(errorFor(`settings.packs.${index}.quantity`) ||
                                        errorFor(`settings.packs.${index}.price`)) && (
                                        <Problem>
                                            {errorFor(`settings.packs.${index}.quantity`) ??
                                                errorFor(`settings.packs.${index}.price`)}
                                        </Problem>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-center"
                    disabled={settings.packs.length >= SALES_LIMITS.packs}
                    onClick={() => {
                        const next = Math.max(0, ...settings.packs.map(pack => pack.quantity)) + 1;
                        set({
                            packs: [
                                ...settings.packs,
                                {
                                    quantity: next,
                                    price: Number.isFinite(unitPrice) ? unitPrice * next : 0,
                                    label: { bn: '', en: '' },
                                    popular: false,
                                },
                            ],
                        });
                    }}
                >
                    <Plus className="size-4" aria-hidden />
                    {t.addPack}
                </Button>
                {errorFor('settings.packs') && <Problem>{errorFor('settings.packs')!}</Problem>}
            </Group>

            <Group title={t.bump} hint={t.bumpHint}>
                <Switch
                    checked={settings.bump.enabled}
                    onChange={enabled => set({ bump: { ...settings.bump, enabled } })}
                    label={t.bumpOn}
                />
                {settings.bump.enabled && (
                    <>
                        <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm">
                                {bumpVariant.data
                                    ? `${bumpVariant.data.product.name}`
                                    : settings.bump.variantId
                                      ? '…'
                                      : t.noProduct}
                            </span>
                            <Button variant="secondary" size="sm" onClick={() => setPicking('bump')}>
                                {settings.bump.variantId ? m.design.change : m.design.chooseProduct}
                            </Button>
                        </div>
                        {(bumpVariants.data?.length ?? 0) > 1 && (
                            <Select
                                aria-label={t.bumpVariant}
                                value={settings.bump.variantId ?? ''}
                                onChange={event =>
                                    set({ bump: { ...settings.bump, variantId: event.target.value } })
                                }
                            >
                                {bumpVariants.data!.map(variant => (
                                    <option key={variant.id} value={variant.id}>
                                        {variant.name} · {format.money(variant.priceWithTax)}
                                    </option>
                                ))}
                            </Select>
                        )}
                        <label className="block text-sm font-medium text-slate-800">
                            {t.bumpPrice}
                            {bumpVariant.data && (
                                <span className="ml-1 font-normal text-slate-500">
                                    ({t.normalPrice(format.money(bumpVariant.data.priceWithTax))})
                                </span>
                            )}
                            <div className="mt-1.5 flex min-h-11 items-center rounded-md border border-slate-300 bg-white focus-within:outline-2 focus-within:outline-teal-600">
                                <span className="pl-3 text-slate-500" aria-hidden>
                                    ৳
                                </span>
                                <input
                                    inputMode="numeric"
                                    className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-1 text-base outline-none"
                                    value={taka(settings.bump.price)}
                                    onChange={event =>
                                        set({
                                            bump: {
                                                ...settings.bump,
                                                price: toPoisha(event.target.value) || null,
                                            },
                                        })
                                    }
                                />
                            </div>
                        </label>
                        <BilingualInput
                            label={t.bumpTitle}
                            language={language}
                            value={settings.bump.title}
                            max={120}
                            onChange={title => set({ bump: { ...settings.bump, title } })}
                        />
                        <BilingualInput
                            label={t.bumpText}
                            language={language}
                            value={settings.bump.text}
                            max={300}
                            multiline
                            onChange={value => set({ bump: { ...settings.bump, text: value } })}
                        />
                        {errorFor('settings.bump') && <Problem>{errorFor('settings.bump')!}</Problem>}
                    </>
                )}
            </Group>

            <Group title={t.look}>
                <Segmented
                    label={t.header}
                    value={settings.header}
                    onChange={header => set({ header })}
                    options={[
                        { value: 'slim', label: t.headerSlim },
                        { value: 'store', label: t.headerStore },
                        { value: 'none', label: t.headerNone },
                    ]}
                />
                <Switch checked={settings.footer} onChange={footer => set({ footer })} label={t.footer} />
                <Segmented
                    label={t.width}
                    value={settings.width}
                    onChange={width => set({ width })}
                    options={[
                        { value: 'phone', label: t.widthPhone },
                        { value: 'full', label: t.widthFull },
                    ]}
                />
                <div>
                    <label
                        htmlFor={`${ids}-font`}
                        className="mb-1.5 block text-sm font-medium text-slate-800"
                    >
                        {t.font}
                    </label>
                    <Select
                        id={`${ids}-font`}
                        value={settings.font}
                        onChange={event => set({ font: event.target.value as SalesPageSettings['font'] })}
                    >
                        <option value="">{t.themeFont}</option>
                        {FONTS.map(font => (
                            <option key={font} value={font}>
                                {pick(FONT_INFO[font].name, ui)}
                            </option>
                        ))}
                    </Select>
                </div>
                {(['main', 'sale', 'background'] as const).map(name => (
                    <FieldControl
                        key={name}
                        field={hexField({ bn: t.colourNames[name]!, en: t.colourNames[name]! })}
                        value={settings.colours[name]}
                        language={language}
                        document={{ sections: [] }}
                        onChange={value => set({ colours: { ...settings.colours, [name]: value as string } })}
                    />
                ))}
                <p className="text-xs text-slate-500">{t.coloursHint}</p>
                <Switch
                    checked={settings.stickyBar}
                    onChange={stickyBar => set({ stickyBar })}
                    label={t.stickyBar}
                    description={t.stickyBarHint}
                />
            </Group>

            <Group title={t.thankYou}>
                <BilingualInput
                    label={t.thankYouMessage}
                    language={language}
                    value={settings.thankYou.message}
                    max={SALES_LIMITS.message}
                    multiline
                    onChange={message => set({ thankYou: { ...settings.thankYou, message } })}
                />
                <Switch
                    checked={settings.thankYou.whatsapp}
                    onChange={whatsapp => set({ thankYou: { ...settings.thankYou, whatsapp } })}
                    label={t.thankYouWhatsapp}
                />
                <div>
                    <label
                        htmlFor={`${ids}-redirect`}
                        className="mb-1.5 block text-sm font-medium text-slate-800"
                    >
                        {t.redirect}
                    </label>
                    <Input
                        id={`${ids}-redirect`}
                        value={settings.thankYou.redirect}
                        placeholder="/product/…"
                        maxLength={300}
                        aria-invalid={errorFor('settings.thankYou.redirect') ? true : undefined}
                        onChange={event =>
                            set({ thankYou: { ...settings.thankYou, redirect: event.target.value } })
                        }
                    />
                    <p className="mt-1.5 text-xs text-slate-500">{t.redirectHint}</p>
                    {errorFor('settings.thankYou.redirect') && (
                        <Problem>{errorFor('settings.thankYou.redirect')!}</Problem>
                    )}
                </div>
            </Group>

            <Group title={t.seo}>
                <Switch
                    checked={settings.hideFromGoogle}
                    onChange={hideFromGoogle => set({ hideFromGoogle })}
                    label={t.hideFromGoogle}
                    description={t.hideFromGoogleHint}
                />
                <BilingualInput
                    label={t.seoTitle}
                    language={language}
                    value={settings.seo.title}
                    max={70}
                    onChange={value => set({ seo: { ...settings.seo, title: value } })}
                />
                <BilingualInput
                    label={t.seoDescription}
                    language={language}
                    value={settings.seo.description}
                    max={200}
                    multiline
                    onChange={value => set({ seo: { ...settings.seo, description: value } })}
                />
                <div>
                    <p className="mb-1.5 text-sm font-medium text-slate-800">{t.shareImage}</p>
                    <ImageUpload
                        maxMegabytes={10}
                        value={
                            settings.seo.image
                                ? { id: settings.seo.image.assetId, preview: settings.seo.image.preview }
                                : null
                        }
                        onChange={image =>
                            set({
                                seo: {
                                    ...settings.seo,
                                    image: image ? { assetId: image.id, preview: image.preview } : null,
                                },
                            })
                        }
                    />
                </div>
            </Group>

            <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 py-3">
                <Button className="w-full justify-center" loading={saving} onClick={() => void save()}>
                    {t.saveSettings}
                </Button>
            </div>

            {picking && (
                <ProductPickerDialog
                    open
                    onClose={() => setPicking(null)}
                    selected={picking === 'product' && productId ? [productId] : []}
                    max={1}
                    onDone={async picked => {
                        const id = picked[0];
                        if (!id) return;
                        if (picking === 'product') {
                            setProductId(id);
                        } else {
                            const first = (await fetchVariants(id))[0];
                            if (first) set({ bump: { ...settings.bump, variantId: first.id } });
                        }
                    }}
                />
            )}
        </div>
    );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section className="space-y-4">
            <div>
                <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
                {hint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

function Problem({ children }: { children: React.ReactNode }) {
    return <p className="mt-1.5 text-xs text-red-700">{children}</p>;
}

/** Text in the language chosen in the editor's toolbar; the other language's shows as a hint. */
function BilingualInput({
    label,
    language,
    value,
    max,
    multiline,
    onChange,
}: {
    label: string;
    language: Language;
    value: Bilingual;
    max: number;
    multiline?: boolean;
    onChange(value: Bilingual): void;
}) {
    const id = useId();
    const other: Language = language === 'bn' ? 'en' : 'bn';
    const set = (next: string) => onChange({ ...value, [language]: next });
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-sm font-medium text-slate-800">
                    {label}
                </label>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {language === 'bn' ? 'বাংলা' : 'English'}
                </span>
            </div>
            {multiline ? (
                <Textarea
                    id={id}
                    lang={language}
                    rows={3}
                    value={value[language]}
                    maxLength={max}
                    placeholder={value[other]}
                    onChange={event => set(event.target.value)}
                />
            ) : (
                <Input
                    id={id}
                    lang={language}
                    value={value[language]}
                    maxLength={max}
                    placeholder={value[other]}
                    onChange={event => set(event.target.value)}
                />
            )}
        </div>
    );
}
