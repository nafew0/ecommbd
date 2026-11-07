import { defineConfig } from '@playwright/test';
import base from './playwright.config';
/** The speed harness owns the built services; test the normal suite through its Varnish URL. */
export default defineConfig({ ...base, webServer: [], reporter: 'list' });
