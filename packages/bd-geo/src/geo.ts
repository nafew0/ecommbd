import data from './data/bd-geo.json';

/**
 * Bangladesh's administrative units: 8 divisions, 64 districts, and below each district its
 * upazilas, city corporations and metropolitan thanas (together called "thanas" here, as shoppers
 * and couriers do). Sources and rules are in ../README.md.
 *
 * IDs are official BBS geocodes in HDX P-code form (`BD30` division, `BD3026` district,
 * `BD30260014` upazila). Units we add ourselves contain an `M` (`BD3026M01`). An ID is never
 * reused for a different place, so stored addresses stay valid across data versions.
 */

export type GeoLanguage = 'bn' | 'en';

/**
 * Delivery zone used for shipping rates and couriers:
 * - `dhaka_city`: Dhaka North and South City Corporation areas (the metropolitan thanas);
 * - `dhaka_suburb`: the rest of Dhaka district (Savar, Keraniganj, Dhamrai, Nawabganj, Dohar);
 * - `chattogram_city`: Chattogram City Corporation areas (a part of "outside Dhaka");
 * - `outside_dhaka`: everywhere else.
 */
export type DeliveryZone = 'dhaka_city' | 'dhaka_suburb' | 'chattogram_city' | 'outside_dhaka';

export const DELIVERY_ZONES: readonly DeliveryZone[] = [
    'dhaka_city',
    'dhaka_suburb',
    'chattogram_city',
    'outside_dhaka',
];

/** City corporation areas and upazilas are different kinds of place, so they keep their own type. */
export type ThanaType = 'upazila' | 'city_corporation' | 'metro_thana';

/**
 * The thana value for "Other / not listed": a place created after this data version was built.
 * It must come with free text in the address's `area` field.
 */
export const OTHER_THANA_ID = 'other';

interface NamedUnit {
    id: string;
    en: string;
    bn: string;
    /** Old and alternate spellings in either language. */
    aliases: readonly string[];
}

export interface Division extends NamedUnit {
    kind: 'division';
}

export interface District extends NamedUnit {
    kind: 'district';
    divisionId: string;
}

export interface Thana extends NamedUnit {
    kind: 'thana';
    districtId: string;
    type: ThanaType;
    zone: DeliveryZone;
}

export type GeoUnit = Division | District | Thana;

/** Version of the dataset. Bumped (with a CHANGELOG entry) whenever units are added or renamed. */
export const dataVersion: string = data.dataVersion;

/** Where the data comes from, for attribution. */
export const dataSources: readonly string[] = data.sources;

const divisions: readonly Division[] = data.divisions.map(unit => ({
    ...unit,
    kind: 'division' as const,
    aliases: unit.aliases ?? [],
}));
const districts: readonly District[] = data.districts.map(unit => ({
    ...unit,
    kind: 'district' as const,
    aliases: unit.aliases ?? [],
}));
const thanas: readonly Thana[] = data.thanas.map(unit => ({
    ...unit,
    kind: 'thana' as const,
    type: unit.type as ThanaType,
    zone: unit.zone as DeliveryZone,
    aliases: unit.aliases ?? [],
}));

const byId = new Map<string, GeoUnit>([...divisions, ...districts, ...thanas].map(unit => [unit.id, unit]));

const thanasByDistrict = new Map<string, Thana[]>();
for (const thana of thanas) {
    const list = thanasByDistrict.get(thana.districtId) ?? [];
    list.push(thana);
    thanasByDistrict.set(thana.districtId, list);
}

/** Every unit, for search and data checks. */
export function allUnits(): readonly GeoUnit[] {
    return [...divisions, ...districts, ...thanas];
}

export function getDivisions(): readonly Division[] {
    return divisions;
}

/** All 64 districts, or those of one division. */
export function getDistricts(divisionId?: string): readonly District[] {
    return divisionId ? districts.filter(district => district.divisionId === divisionId) : districts;
}

/**
 * The places a shopper picks from inside a district: upazilas, metropolitan thanas and city
 * corporations. Where a city's metropolitan thanas are listed (Dhaka, Chattogram), its city
 * corporation units are left out: shoppers know "Mirpur", not "Dhaka North City Corporation".
 * Unknown district: an empty list.
 */
export function getThanas(districtId: string): readonly Thana[] {
    const all = thanasByDistrict.get(districtId) ?? [];
    const hasMetro = all.some(thana => thana.type === 'metro_thana');
    return hasMetro ? all.filter(thana => thana.type !== 'city_corporation') : all;
}

export function findById(id: string): GeoUnit | undefined {
    return byId.get(id);
}

export function findDistrict(id: string): District | undefined {
    const unit = byId.get(id);
    return unit?.kind === 'district' ? unit : undefined;
}

export function findThana(id: string): Thana | undefined {
    const unit = byId.get(id);
    return unit?.kind === 'thana' ? unit : undefined;
}

/** True when the thana exists and belongs to the district. "Other / not listed" is not a thana. */
export function isThanaInDistrict(districtId: string, thanaId: string): boolean {
    return findThana(thanaId)?.districtId === districtId;
}

/**
 * The delivery zone of an address. With a thana, the thana's zone. Without one (or with "Other /
 * not listed"), the district's zone when the whole district shares one, which is every district
 * except Dhaka. Returns `undefined` when it can't be told: an unknown district, a thana from
 * another district, or Dhaka district without a thana (city and suburb rates differ).
 */
export function zoneOf(districtId: string, thanaId?: string): DeliveryZone | undefined {
    if (!findDistrict(districtId)) {
        return undefined;
    }
    if (thanaId && thanaId !== OTHER_THANA_ID) {
        const thana = findThana(thanaId);
        return thana?.districtId === districtId ? thana.zone : undefined;
    }
    const zones = new Set(getThanas(districtId).map(thana => toBroadZone(thana.zone)));
    return zones.size === 1 ? [...zones][0] : undefined;
}

/** Chattogram city is still "outside Dhaka" when we can't narrow it down to the city. */
function toBroadZone(zone: DeliveryZone): DeliveryZone {
    return zone === 'chattogram_city' ? 'outside_dhaka' : zone;
}

export function nameOf(unit: { en: string; bn: string }, language: GeoLanguage): string {
    return language === 'bn' ? unit.bn : unit.en;
}

const collators: Record<GeoLanguage, Intl.Collator> = {
    bn: new Intl.Collator('bn'),
    en: new Intl.Collator('en'),
};

/** Sorts units by name in the given language (a new array). */
export function sortByName<T extends { en: string; bn: string }>(
    units: readonly T[],
    language: GeoLanguage,
): T[] {
    return [...units].sort((a, b) => collators[language].compare(nameOf(a, language), nameOf(b, language)));
}
