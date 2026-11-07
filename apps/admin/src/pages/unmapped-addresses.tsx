import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Field } from '../components/form/field';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/input';
import { Alert, Card, CardBody, EmptyState, PageHeader, PageSkeleton } from '../components/ui/misc';
import { adminApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useToast } from '../lib/toast';

interface Unmapped {
    districtId: string;
    thanaId: string;
    districtName: string;
    thanaName: string;
    orderIds: string[];
}

interface Place {
    id: number;
    name: string;
}

const UNMAPPED = `{ bdUnmappedAddresses { districtId thanaId districtName thanaName orderIds } }`;
const CITIES = `{ bdPathaoCities { id name } }`;
const ZONES = `query ($cityId: Int!) { bdPathaoZones(cityId: $cityId) { id name } }`;
const MAP = `mutation ($districtId: String!, $thanaId: String!, $cityId: Int!, $zoneId: Int!) {
    setBdPathaoMapping(districtId: $districtId, thanaId: $thanaId, cityId: $cityId, zoneId: $zoneId)
}`;
const BOOK_MANY = `mutation ($orderIds: [ID!]!) { bookBdCouriers(orderIds: $orderIds, courier: "pathao") }`;

/**
 * Unmapped addresses (roadmap phase 19): thanas Pathao couldn't match by name. Staff choose Pathao's
 * city and zone once; it's saved for every later order, and the waiting orders are booked.
 */
export function UnmappedAddressesPage() {
    const { messages: m } = useI18n();
    const u = m.couriers.unmapped;
    const query = useQuery({
        queryKey: ['unmappedAddresses'],
        queryFn: () =>
            adminApi<{ bdUnmappedAddresses: Unmapped[] }>(UNMAPPED).then(r => r.bdUnmappedAddresses),
    });
    const cities = useQuery({
        queryKey: ['pathaoCities'],
        queryFn: () => adminApi<{ bdPathaoCities: Place[] }>(CITIES).then(r => r.bdPathaoCities),
    });
    if (query.isPending || cities.isPending) return <PageSkeleton />;
    const items = query.data ?? [];
    return (
        <>
            <PageHeader title={u.title} description={u.description} />
            {cities.data?.length === 0 && (
                <div className="mb-4">
                    <Alert tone="warning">
                        <Link to="/settings/couriers" className="underline">
                            {u.noPlaces}
                        </Link>
                    </Alert>
                </div>
            )}
            {items.length === 0 ? (
                <EmptyState icon={<MapPin className="size-6" aria-hidden />} title={u.empty} body="" />
            ) : (
                <ul className="space-y-3">
                    {items.map(item => (
                        <li key={`${item.districtId}-${item.thanaId}`}>
                            <MapCard item={item} cities={cities.data ?? []} />
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

function MapCard({ item, cities }: { item: Unmapped; cities: Place[] }) {
    const { messages: m } = useI18n();
    const u = m.couriers.unmapped;
    const toast = useToast();
    const { can } = useAuth();
    const queryClient = useQueryClient();
    const [cityId, setCityId] = useState<number | null>(null);
    const [zoneId, setZoneId] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const zones = useQuery({
        queryKey: ['pathaoZones', cityId],
        queryFn: () => adminApi<{ bdPathaoZones: Place[] }>(ZONES, { cityId }).then(r => r.bdPathaoZones),
        enabled: !!cityId,
    });
    const save = async () => {
        if (!cityId || !zoneId) return;
        setBusy(true);
        try {
            await adminApi(MAP, { districtId: item.districtId, thanaId: item.thanaId, cityId, zoneId });
            await adminApi(BOOK_MANY, { orderIds: item.orderIds });
            toast.success(u.saved);
            void queryClient.invalidateQueries({ queryKey: ['unmappedAddresses'] });
        } catch {
            toast.error(m.errors.generic);
        } finally {
            setBusy(false);
        }
    };
    return (
        <Card>
            <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                        {item.thanaName}, {item.districtName}
                    </p>
                    <span className="text-sm text-slate-600">{u.orders(item.orderIds.length)}</span>
                </div>
                {can('BookCourier') && (
                    <div className="flex flex-wrap items-end gap-3">
                        <Field label={u.city}>
                            {control => (
                                <Select
                                    {...control}
                                    className="w-56"
                                    value={cityId ?? ''}
                                    onChange={event => {
                                        setCityId(Number(event.target.value) || null);
                                        setZoneId(null);
                                    }}
                                >
                                    <option value="">—</option>
                                    {cities.map(city => (
                                        <option key={city.id} value={city.id}>
                                            {city.name}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Field label={u.zone}>
                            {control => (
                                <Select
                                    {...control}
                                    className="w-56"
                                    value={zoneId ?? ''}
                                    disabled={!cityId}
                                    onChange={event => setZoneId(Number(event.target.value) || null)}
                                >
                                    <option value="">—</option>
                                    {(zones.data ?? []).map(zone => (
                                        <option key={zone.id} value={zone.id}>
                                            {zone.name}
                                        </option>
                                    ))}
                                </Select>
                            )}
                        </Field>
                        <Button loading={busy} disabled={!cityId || !zoneId} onClick={() => void save()}>
                            {u.save}
                        </Button>
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
