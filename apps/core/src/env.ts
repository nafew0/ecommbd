import 'dotenv/config';
import { loadEnvOrExit } from '@ecommbd/shared';
import { type Env, envSchema } from './env-schema';

// Vendure's timestamp columns have no time zone. Dates written by Node and by PostgreSQL (`now()`,
// e.g. every `createdAt`) only agree when the process runs in UTC, so it always does. Shown and
// calculated in Dhaka time by our helpers (docs/decisions.md, 2026-10-21).
process.env.TZ = 'UTC';

/**
 * The validated environment. Loading this module stops the process with a list of problems
 * if any variable is missing or invalid, before Vendure starts.
 */
export const env: Env = loadEnvOrExit(envSchema, { label: 'apps/core/.env (see .env.example)' });
