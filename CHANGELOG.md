# Changelog

All notable changes to Ecomm BD. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Phase 02, Bangladesh store defaults, place data, store settings and the merchant admin:**
  - `packages/bd-geo`: 8 divisions, 64 districts, 495 upazilas, 12 city corporations and the metropolitan thanas of Dhaka and Chattogram, in Bangla and English, with old spellings, delivery zones (Dhaka city, Dhaka suburbs, Chattogram city, outside Dhaka) and search. Official BBS geocodes as IDs.
  - New stores start ready for Bangladesh: BDT, prices including tax, Bangla (default) and English, Bangladesh enabled, a 0% standard tax and five staff roles (Owner, Manager, Order staff, Packer, Marketing). Runs on start and with `npm run store:init`; never overwrites a merchant's changes.
  - Store settings: name, logo, phones, WhatsApp, address (district → thana), trade licence, social links, business hours, Bangla and English policy templates, language and date format. A new `UpdateStoreSettings` permission and a change history. The storefront sees public fields only.
  - Addresses get district, thana, area, landmark and an alternate phone, checked on the server (the thana must be in the district), on customer and order addresses alike.
  - `bdDistricts` and `bdThanas` in the Shop and Admin APIs, and cacheable `GET /bd-geo/...` routes.
  - The merchant admin at `/admin` (`apps/admin`): sign-in, Bangla/English switch saved per staff member, a sidebar that becomes a drawer on phones, the Store settings page, a district → thana picker, and building blocks for later screens (list page, form dialog, phone, taka and Dhaka-time inputs, image upload). Signing in again after a session ends keeps what was typed.
  - Security: CSRF protection on the APIs, HTTP-only session cookies with separate names for the admin and the storefront, a strict Content Security Policy on `/admin`.
  - Tests: unit tests for bd-geo and the settings schema (100% coverage), end-to-end tests for defaults, settings, permissions, addresses and the place API, and Playwright tests of the admin on a desktop and a phone.

- **Phase 01, engineering foundation:**
  - `packages/shared`, Bangladesh helpers with full test coverage:
    - Bangladeshi phone numbers (normalize, validate, format, mask)
    - taka (whole-taka rounding, lakh grouping, Bangla digits)
    - Bangla text cleaning
    - Dhaka time and quiet hours
    - encryption for stored secrets
    - a safe outbound HTTP client (timeouts, retries, circuit breaker, SSRF protection)
    - idempotency keys
    - settings checks
  - The server checks every setting at startup and lists any that are missing or wrong.
  - JSON logs in staging and production, with request IDs and masked phone numbers and emails.
  - Tests: unit tests, an end-to-end test against PostgreSQL, and a Playwright Dashboard login test.
  - ESLint and Prettier, one GitHub Actions CI job, and Dependabot.
  - `CLAUDE.md`, a decisions log and a Bangla/English glossary.
