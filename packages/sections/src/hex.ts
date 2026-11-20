/** Colour values: on their own, so both the fields and the theme can use them. */

export const HEX = /^#[0-9a-f]{6}$/;

/** `#ABC` or `abcdef` as `#aabbcc`; null when it isn't a colour. */
export function normalizeHex(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    let hex = value.trim().toLowerCase();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[...hex.slice(1)].map(digit => digit + digit).join('')}`;
    return HEX.test(hex) ? hex : null;
}
