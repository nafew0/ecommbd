import 'dotenv/config';
import { loadEnvOrExit } from '@ecommbd/shared';
import { type Env, envSchema } from './env-schema';

/**
 * The validated environment. Loading this module stops the process with a list of problems
 * if any variable is missing or invalid, before Vendure starts.
 */
export const env: Env = loadEnvOrExit(envSchema, { label: 'apps/core/.env (see .env.example)' });
