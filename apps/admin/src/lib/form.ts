/**
 * Small helpers for form state kept as one nested object (e.g. the store settings): read and write
 * by dotted path, and turn validation errors into a path → message-code map.
 */

export type Path = string;

export function getIn(value: unknown, path: Path): unknown {
    return path.split('.').reduce<unknown>((current, key) => {
        if (current === null || current === undefined) return undefined;
        return (current as Record<string, unknown>)[key];
    }, value);
}

/** Returns a copy of `value` with `path` set, copying only the objects along the path. */
export function setIn<T>(value: T, path: Path, next: unknown): T {
    const [head, ...rest] = path.split('.');
    const key = head as string;
    const container: Record<string, unknown> | unknown[] = Array.isArray(value)
        ? [...value]
        : { ...(value as Record<string, unknown>) };
    const child = (container as Record<string, unknown>)[key];
    (container as Record<string, unknown>)[key] = rest.length
        ? setIn(child ?? {}, rest.join('.'), next)
        : next;
    return container as T;
}

export interface FieldError {
    path: string;
    code: string;
}

/** First error per path. */
export function errorMap(errors: readonly FieldError[]): Record<Path, string> {
    const map: Record<Path, string> = {};
    for (const error of errors) {
        map[error.path] ??= error.code;
    }
    return map;
}
