import { expect, type Page } from '@playwright/test';
import { password, username } from './store-api';

/** Fails the test on any Content Security Policy violation or script error. */
export function watchForErrors(page: Page) {
    const errors: string[] = [];
    page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

/** Signs in to the merchant admin in the given language. */
export async function signIn(page: Page, language: 'bn' | 'en', user = username, pass = password) {
    await page.goto('/admin/login');
    await page.getByRole('button', { name: language === 'bn' ? 'বাংলা' : 'English' }).click();
    await page.getByLabel(language === 'bn' ? 'ইমেইল বা ইউজারনেম' : 'Email or username').fill(user);
    await page.getByLabel(language === 'bn' ? 'পাসওয়ার্ড' : 'Password', { exact: true }).fill(pass);
    await page.getByRole('button', { name: language === 'bn' ? 'সাইন ইন' : 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
        language === 'bn' ? 'স্বাগতম' : 'Welcome',
    );
}
