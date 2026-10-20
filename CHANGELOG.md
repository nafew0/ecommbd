# Changelog

All notable changes to Ecomm BD. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
