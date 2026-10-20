import { clsx, type ClassValue } from 'clsx';

/** Joins class names, skipping empty ones. Components pass full classes, so no merging is needed. */
export function cn(...values: ClassValue[]): string {
    return clsx(values);
}
