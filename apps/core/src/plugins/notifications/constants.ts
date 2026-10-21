export const loggerCtx = 'NotificationsPlugin';
export const NOTIFICATIONS_PLUGIN_OPTIONS = Symbol('NOTIFICATIONS_PLUGIN_OPTIONS');

/** Key in Vendure's settings store. */
export const SMS_SETTINGS_KEY = 'notifications.sms';

/** A failing provider is retried this many times (with backoff) before the SMS is marked failed. */
export const SMS_RETRIES = 4;
