import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { Field } from '../form/field';
import { Select } from '../ui/input';

/** Matches OTHER_THANA_ID in @ecommbd/bd-geo. */
export const OTHER_THANA = 'other';

interface District {
    id: string;
    name: string;
}

interface Thana {
    id: string;
    name: string;
    type: 'upazila' | 'city_corporation' | 'metro_thana';
}

/** The lists change only with a new data version, so they're fetched once per language and district. */
export function usePlaces(districtId: string) {
    const { language } = useI18n();
    const districts = useQuery({
        queryKey: ['bdDistricts', language],
        queryFn: () =>
            adminApi<{ bdDistricts: District[] }>(
                'query ($lang: BdGeoLanguage) { bdDistricts(lang: $lang) { id name } }',
                {
                    lang: language,
                },
            ).then(result => result.bdDistricts),
        staleTime: Infinity,
    });
    const thanas = useQuery({
        queryKey: ['bdThanas', districtId, language],
        enabled: Boolean(districtId),
        queryFn: () =>
            adminApi<{ bdThanas: Thana[] }>(
                'query ($districtId: String!, $lang: BdGeoLanguage) { bdThanas(districtId: $districtId, lang: $lang) { id name type } }',
                { districtId, lang: language },
            ).then(result => result.bdThanas),
        staleTime: Infinity,
    });
    return { districts, thanas };
}

export interface DistrictThanaValue {
    districtId: string;
    thanaId: string;
}

interface PickerProps {
    value: DistrictThanaValue;
    onChange(value: DistrictThanaValue): void;
    errors?: { districtId?: string; thanaId?: string };
    disabled?: boolean;
    /** Offer "Other / not listed" (then the form must ask for the area). Default true. */
    allowOther?: boolean;
}

/**
 * District first, then its thanas: always picked by ID, never by name, because names like "Sadar"
 * and "Kotwali" repeat across districts. City areas and upazilas are listed separately.
 */
export function DistrictThanaPicker({
    value,
    onChange,
    errors = {},
    disabled,
    allowOther = true,
}: PickerProps) {
    const { messages: m } = useI18n();
    const { districts, thanas } = usePlaces(value.districtId);
    const cityAreas = thanas.data?.filter(thana => thana.type !== 'upazila') ?? [];
    const upazilas = thanas.data?.filter(thana => thana.type === 'upazila') ?? [];
    const failed = districts.isError || thanas.isError;

    return (
        <div className="grid gap-4 sm:grid-cols-2">
            <Field label={m.address.district} error={errors.districtId}>
                {control => (
                    <Select
                        {...control}
                        value={value.districtId}
                        disabled={disabled || districts.isLoading}
                        onChange={event => onChange({ districtId: event.target.value, thanaId: '' })}
                    >
                        <option value="">
                            {districts.isLoading ? m.common.loading : m.address.chooseDistrict}
                        </option>
                        {districts.data?.map(district => (
                            <option key={district.id} value={district.id}>
                                {district.name}
                            </option>
                        ))}
                    </Select>
                )}
            </Field>
            <Field label={m.address.thana} error={errors.thanaId}>
                {control => (
                    <Select
                        {...control}
                        value={value.thanaId}
                        disabled={disabled || !value.districtId || thanas.isLoading}
                        onChange={event =>
                            onChange({ districtId: value.districtId, thanaId: event.target.value })
                        }
                    >
                        <option value="">
                            {!value.districtId
                                ? m.address.chooseDistrictFirst
                                : thanas.isLoading
                                  ? m.common.loading
                                  : m.address.chooseThana}
                        </option>
                        {cityAreas.length > 0 && (
                            <optgroup label={m.address.groupCity}>
                                {cityAreas.map(thana => (
                                    <option key={thana.id} value={thana.id}>
                                        {thana.name}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                        {upazilas.length > 0 && (
                            <optgroup label={m.address.groupUpazila}>
                                {upazilas.map(thana => (
                                    <option key={thana.id} value={thana.id}>
                                        {thana.name}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                        {allowOther && value.districtId && thanas.data && (
                            <option value={OTHER_THANA}>{m.address.otherThana}</option>
                        )}
                    </Select>
                )}
            </Field>
            {failed && (
                <p role="alert" className="text-sm text-red-700 sm:col-span-2">
                    {m.address.loadFailed}
                </p>
            )}
        </div>
    );
}
