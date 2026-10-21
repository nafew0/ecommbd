import { usePlaces } from './district-thana-picker';

/** "Mirpur 10, Mirpur, Dhaka" in the admin's language, from the IDs on an address. */
export function PlaceName({
    districtId,
    thanaId,
    area,
}: {
    districtId?: string | null;
    thanaId?: string | null;
    area?: string | null;
}) {
    const { districts, thanas } = usePlaces(districtId ?? '');
    const district = districts.data?.find(candidate => candidate.id === districtId)?.name;
    const thana = thanas.data?.find(candidate => candidate.id === thanaId)?.name;
    const parts = [area, thana, district].filter((part, index, all) => part && all.indexOf(part) === index);
    return <>{parts.join(', ')}</>;
}

/** The district's name in the admin's language. */
export function DistrictName({ districtId }: { districtId?: string | null }) {
    const { districts } = usePlaces('');
    return <>{districts.data?.find(candidate => candidate.id === districtId)?.name ?? ''}</>;
}
