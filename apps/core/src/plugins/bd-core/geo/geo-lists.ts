import {
    type GeoLanguage,
    getDistricts,
    getThanas,
    nameOf,
    sortByName,
    type DeliveryZone,
    type ThanaType,
} from '@ecommbd/bd-geo';

/**
 * The district and thana lists the storefront and admin pick from, sorted by name in the
 * requested language. They hold no personal data and only change with a new bd-geo version,
 * so they're computed once and cached by browsers and Varnish.
 */

export interface DistrictListItem {
    id: string;
    name: string;
    nameBn: string;
    nameEn: string;
    divisionId: string;
}

export interface ThanaListItem {
    id: string;
    name: string;
    nameBn: string;
    nameEn: string;
    districtId: string;
    type: ThanaType;
    zone: DeliveryZone;
}

const districtCache = new Map<GeoLanguage, DistrictListItem[]>();
const thanaCache = new Map<string, ThanaListItem[]>();

export function toGeoLanguage(value: string | undefined | null, fallback: GeoLanguage = 'en'): GeoLanguage {
    return value === 'bn' || value === 'en' ? value : fallback;
}

export function districtList(lang: GeoLanguage): DistrictListItem[] {
    let list = districtCache.get(lang);
    if (!list) {
        list = sortByName(getDistricts(), lang).map(district => ({
            id: district.id,
            name: nameOf(district, lang),
            nameBn: district.bn,
            nameEn: district.en,
            divisionId: district.divisionId,
        }));
        districtCache.set(lang, list);
    }
    return list;
}

/** Thanas of a district; an unknown district gives an empty list. */
export function thanaList(districtId: string, lang: GeoLanguage): ThanaListItem[] {
    const key = `${lang}:${districtId}`;
    let list = thanaCache.get(key);
    if (!list) {
        list = sortByName(getThanas(districtId), lang).map(thana => ({
            id: thana.id,
            name: nameOf(thana, lang),
            nameBn: thana.bn,
            nameEn: thana.en,
            districtId: thana.districtId,
            type: thana.type,
            zone: thana.zone,
        }));
        if (list.length > 0) {
            thanaCache.set(key, list);
        }
    }
    return list;
}
