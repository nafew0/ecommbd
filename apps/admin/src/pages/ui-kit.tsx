import { useQuery } from '@tanstack/react-query';
import { parseBdPhone } from '@ecommbd/shared/phone';
import { Inbox } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { AddressForm, type AddressValue } from '../components/address/address-form';
import { Field } from '../components/form/field';
import { DhakaDateTimeInput, PhoneInput, TakaInput } from '../components/form/inputs';
import { type Column, ListPage } from '../components/list-page';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useConfirm } from '../lib/confirm';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

interface District {
    id: string;
    name: string;
    divisionId: string;
}

const DIVISIONS: Record<string, { bn: string; en: string }> = {
    BD10: { bn: 'বরিশাল', en: 'Barishal' },
    BD20: { bn: 'চট্টগ্রাম', en: 'Chattogram' },
    BD30: { bn: 'ঢাকা', en: 'Dhaka' },
    BD40: { bn: 'খুলনা', en: 'Khulna' },
    BD45: { bn: 'ময়মনসিংহ', en: 'Mymensingh' },
    BD50: { bn: 'রাজশাহী', en: 'Rajshahi' },
    BD55: { bn: 'রংপুর', en: 'Rangpur' },
    BD60: { bn: 'সিলেট', en: 'Sylhet' },
};

const PAGE_SIZE = 10;

/** A living reference of the admin's building blocks, with real data where it helps. */
export function UiKitPage() {
    const { messages: m, language } = useI18n();
    const toast = useToast();
    const confirm = useConfirm();
    const u = m.uiKit;

    // List page, using the district list as sample data.
    const districts = useQuery({
        queryKey: ['bdDistricts', language, 'withDivision'],
        queryFn: () =>
            adminApi<{ bdDistricts: District[] }>(
                'query ($lang: BdGeoLanguage) { bdDistricts(lang: $lang) { id name divisionId } }',
                {
                    lang: language,
                },
            ).then(result => result.bdDistricts),
        staleTime: Infinity,
    });
    const [search, setSearch] = useState('');
    const [division, setDivision] = useState('all');
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const filtered = useMemo(
        () =>
            (districts.data ?? []).filter(
                district =>
                    (division === 'all' || district.divisionId === division) &&
                    district.name.toLowerCase().includes(search.trim().toLowerCase()),
            ),
        [districts.data, division, search],
    );
    const columns: Column<District>[] = [
        { key: 'name', header: u.name, cell: row => <span className="font-medium">{row.name}</span> },
        { key: 'division', header: u.division, cell: row => DIVISIONS[row.divisionId]?.[language] },
        {
            key: 'id',
            header: 'ID',
            cell: row => <code className="text-xs text-slate-500">{row.id}</code>,
            hideOnMobile: true,
        },
    ];
    const counts = (id: string) =>
        (districts.data ?? []).filter(district => id === 'all' || district.divisionId === id).length;

    // Form dialog with validation in both languages.
    const [dialogOpen, setDialogOpen] = useState(false);
    const [phone, setPhone] = useState('');
    const [phoneError, setPhoneError] = useState<string>();
    const submitDialog = (event: FormEvent) => {
        event.preventDefault();
        const parsed = parseBdPhone(phone);
        if (!parsed.ok) {
            setPhoneError(parsed.code === 'EMPTY' ? 'required' : 'invalidPhone');
            return;
        }
        setDialogOpen(false);
        toast.success(u.saved);
    };

    const [price, setPrice] = useState<number | null>(125000);
    const [priceError, setPriceError] = useState<string>();
    const [startsAt, setStartsAt] = useState<string | null>(null);
    const [address, setAddress] = useState<AddressValue>({ line: '', area: '', districtId: '', thanaId: '' });

    return (
        <>
            <PageHeader title={u.title} description={u.description} />
            <div className="space-y-8">
                <section className="space-y-3">
                    <h2 className="text-lg font-semibold">
                        {u.listTitle}: {u.listSample}
                    </h2>
                    <ListPage
                        rows={filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
                        rowId={row => row.id}
                        columns={columns}
                        loading={districts.isLoading}
                        search={{
                            value: search,
                            onChange: value => {
                                setSearch(value);
                                setPage(1);
                            },
                        }}
                        tabs={{
                            items: [
                                { key: 'all', label: m.list.all, count: counts('all') },
                                ...Object.entries(DIVISIONS).map(([id, name]) => ({
                                    key: id,
                                    label: name[language],
                                    count: counts(id),
                                })),
                            ],
                            active: division,
                            onChange: key => {
                                setDivision(key);
                                setPage(1);
                            },
                        }}
                        pagination={{ page, pageSize: PAGE_SIZE, total: filtered.length, onChange: setPage }}
                        selection={{
                            selected,
                            onChange: setSelected,
                            actions: (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => toast.info(m.list.selected(selected.size))}
                                >
                                    {u.showToast}
                                </Button>
                            ),
                        }}
                        empty={
                            <EmptyState
                                icon={<Inbox className="size-6" aria-hidden />}
                                title={m.list.noResults}
                                body=""
                            />
                        }
                    />
                </section>

                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader title={u.formTitle} />
                        <CardBody>
                            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                                {u.openDialog}
                            </Button>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader title={u.confirmTitle} />
                        <CardBody>
                            <Button
                                variant="secondary"
                                onClick={async () => {
                                    const yes = await confirm({
                                        title: m.confirm.discardTitle,
                                        body: m.confirm.discardBody,
                                        danger: true,
                                    });
                                    toast.info(yes ? u.confirmed : u.cancelled);
                                }}
                            >
                                {u.openConfirm}
                            </Button>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader title={u.toastTitle} />
                        <CardBody>
                            <Button variant="secondary" onClick={() => toast.success(u.toastMessage)}>
                                {u.showToast}
                            </Button>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader title={u.emptyTitle} />
                        <EmptyState
                            icon={<Inbox className="size-6" aria-hidden />}
                            title={u.emptyHeading}
                            body={u.emptyBody}
                        />
                    </Card>
                </div>

                <Card>
                    <CardHeader title={u.inputsTitle} />
                    <CardBody className="grid gap-4 sm:grid-cols-2">
                        <Field label={u.price} hint={m.inputs.wholeTakaOnly} error={priceError}>
                            {control => (
                                <TakaInput
                                    {...control}
                                    value={price}
                                    onChange={value => {
                                        setPrice(value);
                                        setPriceError(undefined);
                                    }}
                                    onInvalid={reason =>
                                        setPriceError(reason === 'fraction' ? 'invalid' : 'invalid')
                                    }
                                />
                            )}
                        </Field>
                        <Field label={u.startsAt} hint={m.inputs.dhakaTimeHint}>
                            {control => (
                                <DhakaDateTimeInput {...control} value={startsAt} onChange={setStartsAt} />
                            )}
                        </Field>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title={u.addressTitle} />
                    <CardBody>
                        <AddressForm value={address} onChange={setAddress} />
                    </CardBody>
                </Card>
            </div>

            <Dialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                title={u.dialogTitle}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                            {m.common.cancel}
                        </Button>
                        <Button type="submit" form="ui-kit-dialog-form">
                            {m.common.save}
                        </Button>
                    </>
                }
            >
                <form id="ui-kit-dialog-form" onSubmit={submitDialog} noValidate>
                    <Field label={m.settings.fields.phones} error={phoneError}>
                        {control => (
                            <PhoneInput
                                {...control}
                                value={phone}
                                onChange={value => {
                                    setPhone(value);
                                    setPhoneError(undefined);
                                }}
                            />
                        )}
                    </Field>
                </form>
            </Dialog>
        </>
    );
}
