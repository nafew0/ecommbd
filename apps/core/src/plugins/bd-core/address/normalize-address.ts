import { findDistrict, findThana, isThanaInDistrict, OTHER_THANA_ID } from '@ecommbd/bd-geo';
import { cleanText, parseBdPhone } from '@ecommbd/shared';

/**
 * Checks and completes an address before Vendure saves it (customer and order addresses):
 * - the thana must belong to the district; IDs, not names, decide the place;
 * - "Other / not listed" (`thanaId: 'other'`) needs the place written in `area`;
 * - `city` and `province` are filled in English from the IDs, for couriers and older tools;
 * - the alternate phone is stored as E.164 (Bangla digits accepted, landlines allowed);
 * - free text is cleaned (NFC, spaces), and empty strings become null.
 *
 * Inputs without our fields pass through unchanged, so addresses abroad and imports still work.
 */

export type BdAddressErrorCode =
    | 'district-and-thana-together'
    | 'unknown-district'
    | 'thana-not-in-district'
    | 'other-needs-area'
    | 'not-bangladesh'
    | 'invalid-alternate-phone';

export class BdAddressError extends Error {
    constructor(public readonly code: BdAddressErrorCode) {
        super(`Invalid address: ${code}`);
        this.name = 'BdAddressError';
    }
}

interface AddressCustomFieldsInput {
    districtId?: string | null;
    thanaId?: string | null;
    area?: string | null;
    landmark?: string | null;
    alternatePhone?: string | null;
}

export interface AddressInputLike {
    countryCode?: string | null;
    city?: string | null;
    province?: string | null;
    customFields?: AddressCustomFieldsInput | null;
}

const present = (value: string | null | undefined): value is string =>
    typeof value === 'string' && value !== '';

function cleanOptional(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    const cleaned = value === null ? '' : cleanText(value);
    return cleaned === '' ? null : cleaned;
}

export function normalizeAddressInput<T extends AddressInputLike>(input: T): T {
    if (!input.customFields) {
        return input;
    }
    const fields: AddressCustomFieldsInput = { ...input.customFields };
    const result: T = { ...input, customFields: fields };

    for (const key of ['area', 'landmark'] as const) {
        if (key in fields) {
            fields[key] = cleanOptional(fields[key]);
        }
    }
    if ('alternatePhone' in fields) {
        const raw = cleanOptional(fields.alternatePhone);
        if (raw) {
            const parsed = parseBdPhone(raw);
            if (!parsed.ok) {
                throw new BdAddressError('invalid-alternate-phone');
            }
            fields.alternatePhone = parsed.phone.e164;
        } else {
            fields.alternatePhone = raw;
        }
    }

    const districtId = fields.districtId?.trim();
    const thanaId = fields.thanaId?.trim();
    if ('districtId' in fields) fields.districtId = present(districtId) ? districtId : null;
    if ('thanaId' in fields) fields.thanaId = present(thanaId) ? thanaId : null;
    if (!present(districtId) && !present(thanaId)) {
        return result;
    }
    if (!present(districtId) || !present(thanaId)) {
        throw new BdAddressError('district-and-thana-together');
    }
    if (present(input.countryCode) && input.countryCode.toUpperCase() !== 'BD') {
        throw new BdAddressError('not-bangladesh');
    }
    const district = findDistrict(districtId);
    if (!district) {
        throw new BdAddressError('unknown-district');
    }
    if (thanaId === OTHER_THANA_ID) {
        if (!present(fields.area)) {
            throw new BdAddressError('other-needs-area');
        }
        result.city = fields.area;
    } else if (isThanaInDistrict(districtId, thanaId)) {
        result.city = findThana(thanaId)!.en;
    } else {
        throw new BdAddressError('thana-not-in-district');
    }
    result.province = district.en;
    return result;
}
