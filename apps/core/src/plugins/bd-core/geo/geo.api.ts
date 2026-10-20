import gql from 'graphql-tag';

/** Same queries in the Shop API (storefront checkout) and the Admin API (address forms). */
export const geoApiExtensions = gql`
    enum BdGeoLanguage {
        bn
        en
    }

    enum BdDeliveryZone {
        dhaka_city
        dhaka_suburb
        chattogram_city
        outside_dhaka
    }

    enum BdThanaType {
        upazila
        city_corporation
        metro_thana
    }

    type BdDistrict {
        "BBS geocode, e.g. BD3026 (Dhaka)"
        id: String!
        "Name in the requested language"
        name: String!
        nameBn: String!
        nameEn: String!
        divisionId: String!
    }

    type BdThana {
        "BBS geocode (BD30260072) or our own metro thana ID (BD3026M26)"
        id: String!
        name: String!
        nameBn: String!
        nameEn: String!
        districtId: String!
        type: BdThanaType!
        zone: BdDeliveryZone!
    }

    extend type Query {
        "All 64 districts, sorted by name. lang defaults to the request's languageCode."
        bdDistricts(lang: BdGeoLanguage): [BdDistrict!]!
        "Upazilas and city areas of a district, sorted by name. Unknown district: an empty list."
        bdThanas(districtId: String!, lang: BdGeoLanguage): [BdThana!]!
        "Version of the place data. Changes when places are added or renamed."
        bdGeoDataVersion: String!
    }
`;
