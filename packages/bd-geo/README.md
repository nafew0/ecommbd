# @ecommbd/bd-geo

Bangladesh's places for addresses, shipping and couriers: **8 divisions → 64 districts → 572 thana-level units** (495 upazilas, 12 city corporations, 65 metropolitan thanas), each with a Bangla and an English name, old and alternate spellings, and a delivery zone. No dependencies; works in Node and the browser.

```ts
import { getDistricts, getThanas, zoneOf, search } from '@ecommbd/bd-geo';

getThanas('BD3026');                 // Dhaka: 50 metro thanas + 5 upazilas
zoneOf('BD3026', 'BD3026M26');       // 'dhaka_city' (Mirpur)
search('Bogra')[0].unit.en;          // 'Bogura'
```

## Rules

- **IDs are official BBS geocodes** in HDX P-code form: `BD30` (Dhaka division), `BD3026` (Dhaka district), `BD30260072` (Savar upazila), `BD30262500` (Dhaka North City Corporation).
- **Units we add ourselves contain an `M`:** `BD3026M01` … `BD3026M50` (Dhaka metropolitan thanas), `BD2015M01` … `BD2015M15` (Chattogram). They can't collide with an official code.
- **An ID is never reused.** If a place is renamed, keep its ID and move the old name to `aliases`. If a place is split, add the new units with new IDs and keep the old one.
- **Pick by ID, never by name.** Every district has a "Sadar"; "Kotwali", "Bandar" and "Mirpur" exist in several districts. `search()` helps a person find a place; addresses store the IDs from the district → thana lists.
- **Not listed?** Use `OTHER_THANA_ID` (`'other'`) with free text in the address's `area`, and add the place in the next data version.
- Names are NFC-normalized. ZWJ/ZWNJ are kept.

## What `getThanas(districtId)` returns

Upazilas, plus the city's areas. Where we list a city's metropolitan thanas (Dhaka, Chattogram), its city corporation units are left out: shoppers know "Mirpur", not "Dhaka North City Corporation". Other cities (Khulna, Rajshahi, Sylhet, Gazipur and the rest) appear as one "… City Corporation" option until their metro thanas are added.

## Delivery zones

| Zone | Places |
|---|---|
| `dhaka_city` | Dhaka's 50 metropolitan thanas, and the two Dhaka city corporations |
| `dhaka_suburb` | The rest of Dhaka district: Savar (with Ashulia), Keraniganj, Dhamrai, Nawabganj, Dohar |
| `chattogram_city` | Chattogram's 15 metropolitan thanas and its city corporation (still "outside Dhaka" for most rates) |
| `outside_dhaka` | Everything else, including Gazipur and Narayanganj |

`zoneOf(districtId, thanaId?)` returns `undefined` when it can't tell: an unknown district, a thana from another district, or Dhaka district without a thana.

## Size

The whole dataset is about 15 KB gzipped. The checkout never loads all of it: it asks the Shop API for the district list, then one district's thanas. A test keeps each of those under 15 KB.

## Sources and licences

| Data | Source | Licence |
|---|---|---|
| IDs and English names of divisions, districts, upazilas and city corporations | Bangladesh Bureau of Statistics (BBS), published by OCHA on HDX: [Bangladesh – Subnational Administrative Boundaries](https://data.humdata.org/dataset/cod-ab-bgd) (v03, valid from 2023-05-20) | [CC BY-IGO](https://creativecommons.org/licenses/by/3.0/igo/) |
| Bangla names of districts and upazilas, and their alternate English spellings | [nuhil/bangladesh-geocode](https://github.com/nuhil/bangladesh-geocode) | MIT, © 2014 Nuhil Mehdy |
| Metropolitan thanas of Dhaka (DMP) and Chattogram (CMP), Bangla names of city corporations, renamed upazilas (Indurkani, Shantiganj, Shayestaganj…), extra aliases | Compiled by Ecomm BD | Same as this repository |

The data file is `src/data/bd-geo.json`, one unit per line so changes are easy to review. It was generated once from the sources above (matching Bangla names by district and spelling), then corrected by hand. From now on it's edited directly.

## Changing the data

1. Edit `src/data/bd-geo.json`.
2. Bump `dataVersion` (`2026.1` → `2026.2`) and add a line to [CHANGELOG.md](CHANGELOG.md).
3. Run `npm test -w @ecommbd/bd-geo`: it checks counts, parents, ID formats, uniqueness, both names, NFC and size.
