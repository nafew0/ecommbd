import { banglaToAsciiDigits, cleanText } from './text';

/**
 * Bangladeshi phone numbers.
 *
 * Stored as E.164 (`+8801XXXXXXXXX`), shown as `01XXX-XXXXXX`.
 * Mobile numbers are 11 digits starting with 013–019.
 */

export type BdOperator = 'Grameenphone' | 'Banglalink' | 'Teletalk' | 'Robi';

export interface MobilePhone {
    kind: 'mobile';
    /** `+8801712345678` */
    e164: string;
    /** `01712345678` */
    national: string;
    operator: BdOperator;
}

export interface LandlinePhone {
    kind: 'landline';
    /** `+88029123456` */
    e164: string;
    /** `029123456` */
    national: string;
}

export type BdPhone = MobilePhone | LandlinePhone;

/**
 * - `EMPTY`: nothing was entered.
 * - `INVALID`: no Bangladeshi number could be found.
 * - `NOT_MOBILE`: only a landline was found where a mobile number is required.
 */
export type PhoneErrorCode = 'EMPTY' | 'INVALID' | 'NOT_MOBILE';

export type PhoneResult<T extends BdPhone> =
    | {
          ok: true;
          phone: T;
          /** Other valid numbers found in the same input (national format), e.g. a second number. */
          extras: string[];
      }
    | { ok: false; code: PhoneErrorCode };

const OPERATORS: Record<string, BdOperator> = {
    '013': 'Grameenphone',
    '017': 'Grameenphone',
    '014': 'Banglalink',
    '019': 'Banglalink',
    '015': 'Teletalk',
    '016': 'Robi',
    '018': 'Robi',
};

const MOBILE = /^01[3-9]\d{8}$/;
/** 0 + area code + subscriber number: 9 to 11 digits in total, not starting 01. */
const LANDLINE = /^0[2-9]\d{7,9}$/;
/** A run of digits that may contain spaces, dashes, dots and brackets, optionally prefixed by + or 00. */
const CANDIDATE = /(?:\+|00)?\d(?:[\s\-().]*\d)*/g;
/** Mobile forms used when splitting several numbers typed without a separator we can see. */
const MOBILE_PREFIX = /^(?:8801[3-9]\d{8}|01[3-9]\d{8}|1[3-9]\d{8})/;

function toNational(digits: string): string | undefined {
    let rest = digits;
    if (rest.startsWith('00')) {
        rest = rest.slice(2);
    }
    if (rest.startsWith('880')) {
        // People sometimes keep the leading 0 after the country code: "+880 01712345678".
        const afterCode = rest.slice(3);
        return afterCode.startsWith('0') ? afterCode : '0' + afterCode;
    }
    if (rest.startsWith('0')) {
        return rest;
    }
    if (/^1[3-9]\d{8}$/.test(rest)) {
        return '0' + rest;
    }
    return undefined;
}

function classify(national: string): BdPhone | undefined {
    if (MOBILE.test(national)) {
        return {
            kind: 'mobile',
            e164: '+880' + national.slice(1),
            national,
            operator: OPERATORS[national.slice(0, 3)] as BdOperator,
        };
    }
    if (LANDLINE.test(national)) {
        return { kind: 'landline', e164: '+880' + national.slice(1), national };
    }
    return undefined;
}

/** Splits a digit string holding several mobile numbers typed back to back, e.g. "01712345678 01812345678". */
function splitMobiles(digits: string): BdPhone[] {
    const found: BdPhone[] = [];
    let rest = digits;
    while (rest.length > 0) {
        const match = MOBILE_PREFIX.exec(rest);
        if (!match) {
            return [];
        }
        found.push(classify(toNational(match[0]) as string) as BdPhone);
        rest = rest.slice(match[0].length);
    }
    return found;
}

/** Finds every Bangladeshi number in free text, in order of appearance. */
export function findBdPhones(input: string): BdPhone[] {
    const text = cleanText(banglaToAsciiDigits(input));
    const phones: BdPhone[] = [];
    for (const candidate of text.match(CANDIDATE) ?? []) {
        const digits = candidate.replace(/\D/g, '');
        const national = toNational(digits);
        const single = national === undefined ? undefined : classify(national);
        if (single) {
            phones.push(single);
        } else {
            phones.push(...splitMobiles(digits));
        }
    }
    return phones;
}

function parse<T extends BdPhone>(input: string, accept: (phone: BdPhone) => phone is T): PhoneResult<T> {
    if (cleanText(input) === '') {
        return { ok: false, code: 'EMPTY' };
    }
    const phones = findBdPhones(input);
    const accepted = phones.filter(accept);
    const [first, ...others] = accepted;
    if (!first) {
        return { ok: false, code: phones.length > 0 ? 'NOT_MOBILE' : 'INVALID' };
    }
    return { ok: true, phone: first, extras: others.map(phone => phone.national) };
}

/** Parses a Bangladeshi mobile number. Landlines are rejected with `NOT_MOBILE`. */
export function parseBdMobile(input: string): PhoneResult<MobilePhone> {
    return parse(input, (phone): phone is MobilePhone => phone.kind === 'mobile');
}

/** Parses a Bangladeshi mobile or landline number (for example an alternate contact number). */
export function parseBdPhone(input: string): PhoneResult<BdPhone> {
    return parse(input, (_phone): _phone is BdPhone => true);
}

function nationalOf(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return toNational(digits) ?? digits;
}

/** Formats a number for display: mobiles as `01712-345678`, landlines unchanged in national form. */
export function formatBdPhone(phone: string): string {
    const national = nationalOf(phone);
    return MOBILE.test(national) ? `${national.slice(0, 5)}-${national.slice(5)}` : national;
}

/** Masks a number for logs and limited roles, keeping only the last 3 digits: `01******678`. */
export function maskPhone(phone: string): string {
    const national = nationalOf(phone);
    if (national.length <= 5) {
        return '*'.repeat(national.length);
    }
    return national.slice(0, 2) + '*'.repeat(national.length - 5) + national.slice(-3);
}
