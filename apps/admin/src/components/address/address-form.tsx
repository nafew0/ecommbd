import { useI18n } from '../../lib/i18n';
import { Field } from '../form/field';
import { Input, Textarea } from '../ui/input';
import { DistrictThanaPicker, OTHER_THANA } from './district-thana-picker';

export interface AddressValue {
    line: string;
    area: string;
    districtId: string;
    thanaId: string;
}

interface AddressFormProps {
    value: AddressValue;
    onChange(value: AddressValue): void;
    /** Error codes by field name. */
    errors?: Partial<Record<keyof AddressValue, string>>;
    disabled?: boolean;
}

/** A Bangladeshi address: the address line, district → thana, and the area shoppers actually say. */
export function AddressForm({ value, onChange, errors = {}, disabled }: AddressFormProps) {
    const { messages: m } = useI18n();
    const other = value.thanaId === OTHER_THANA;
    return (
        <div className="space-y-4">
            <Field label={m.address.line} hint={m.address.lineHint} error={errors.line}>
                {control => (
                    <Textarea
                        {...control}
                        rows={2}
                        className="min-h-0"
                        autoComplete="street-address"
                        value={value.line}
                        disabled={disabled}
                        onChange={event => onChange({ ...value, line: event.target.value })}
                    />
                )}
            </Field>
            <DistrictThanaPicker
                value={value}
                disabled={disabled}
                errors={{ districtId: errors.districtId, thanaId: errors.thanaId }}
                onChange={places => onChange({ ...value, ...places })}
            />
            <Field
                label={m.address.area}
                hint={other ? m.address.areaRequiredForOther : m.address.areaHint}
                optional={!other}
                error={errors.area ?? (other && !value.area.trim() ? 'required' : undefined)}
            >
                {control => (
                    <Input
                        {...control}
                        value={value.area}
                        disabled={disabled}
                        onChange={event => onChange({ ...value, area: event.target.value })}
                    />
                )}
            </Field>
        </div>
    );
}
