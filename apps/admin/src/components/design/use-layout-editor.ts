import type { LayoutDocument } from '@ecommbd/sections';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import {
    type AdminLayout,
    discardDraft,
    type LayoutConflict,
    type LayoutWarning,
    publishLayout,
    restoreVersion,
    saveDraft,
} from './design-api';

/**
 * The page editor's state (roadmap phase 15): the document being edited with undo and redo, and
 * autosave. Saves are debounced, one at a time, and carry the draft revision this editor last
 * saw; if someone else saved in between, the save comes back as a conflict for the merchant to
 * settle (reload theirs, or keep theirs by overwriting). The server's copy of the document never
 * replaces what's being typed: only the revision and the warnings come back from a save.
 */

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'offline';

export interface ConflictState extends LayoutConflict {
    kind: 'draft' | 'publish';
}

const HISTORY_LIMIT = 100;
/** Typing in one field within this time is one undo step. */
const COALESCE_MS = 1200;
const SAVE_DELAY_MS = 700;

export function useLayoutEditor(initial: AdminLayout) {
    const [layout, setLayout] = useState(initial);
    const [document, setDocument] = useState<LayoutDocument>(initial.draft);
    // Undo history in a ref (state updaters must stay free of side effects); `tick` re-renders.
    const history = useRef<{ past: LayoutDocument[]; future: LayoutDocument[] }>({ past: [], future: [] });
    const [, setTick] = useState(0);
    const [status, setStatus] = useState<SaveStatus>('saved');
    const [warnings, setWarnings] = useState<LayoutWarning[]>(initial.warnings);
    const [conflict, setConflict] = useState<ConflictState | null>(null);
    /** Bumped after every successful save: the preview reloads its sections then. */
    const [savedCount, setSavedCount] = useState(0);

    // `baseVersion`: the published version this editor started from. Saves don't move it (they may
    // learn of someone else's publish), so publishing over that publish asks first.
    const latest = useRef({
        document,
        revision: initial.draftRevision,
        layoutId: initial.id,
        baseVersion: initial.publishedVersion,
    });
    latest.current.document = document;
    const coalesce = useRef<{ key: string; at: number } | null>(null);
    const saving = useRef<Promise<void> | null>(null);
    const again = useRef(false);
    const timer = useRef<number | undefined>(undefined);
    const dirty = useRef(false);

    /** Starts over from a layout the server sent (load, reload theirs, restore, discard). */
    const reset = useCallback((next: AdminLayout) => {
        window.clearTimeout(timer.current);
        dirty.current = false;
        latest.current = {
            document: next.draft,
            revision: next.draftRevision,
            layoutId: next.id,
            baseVersion: next.publishedVersion,
        };
        setLayout(next);
        setDocument(next.draft);
        setWarnings(next.warnings);
        history.current = { past: [], future: [] };
        setConflict(null);
        setStatus('saved');
        setSavedCount(count => count + 1);
    }, []);

    const runSave = useCallback(async (force = false): Promise<void> => {
        if (saving.current) {
            again.current = true;
            return saving.current;
        }
        const { document: snapshot, revision, layoutId } = latest.current;
        dirty.current = false;
        setStatus('saving');
        const run = (async () => {
            try {
                const result = await saveDraft(layoutId, snapshot, revision, force);
                if (result.conflict) {
                    dirty.current = true;
                    setConflict({ ...result.conflict, kind: 'draft' });
                    setStatus('pending');
                    return;
                }
                if (!result.layout) {
                    dirty.current = true;
                    setWarnings(result.errors);
                    setStatus('error');
                    return;
                }
                latest.current.revision = result.layout.draftRevision;
                setLayout(current => ({ ...result.layout!, draft: current.draft }));
                setWarnings(result.layout.warnings);
                setSavedCount(count => count + 1);
                setStatus(dirty.current ? 'pending' : 'saved');
            } catch (error) {
                dirty.current = true;
                setStatus(error instanceof ApiError && error.code === 'NETWORK' ? 'offline' : 'error');
                // Try again after a pause; typing meanwhile schedules its own save.
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => void runSave(), 4000);
            }
        })();
        saving.current = run;
        await run;
        saving.current = null;
        if (again.current) {
            again.current = false;
            if (dirty.current) await runSave();
        }
    }, []);

    const scheduleSave = useCallback(() => {
        dirty.current = true;
        setStatus('pending');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => void runSave(), SAVE_DELAY_MS);
    }, [runSave]);

    /** Applies a change. Changes with the same `key` in quick succession are one undo step. */
    const change = useCallback(
        (next: LayoutDocument, key?: string) => {
            const now = Date.now();
            const merge = key && coalesce.current?.key === key && now - coalesce.current.at < COALESCE_MS;
            coalesce.current = key ? { key, at: now } : null;
            if (!merge) {
                history.current.past = [
                    ...history.current.past.slice(-(HISTORY_LIMIT - 1)),
                    latest.current.document,
                ];
            }
            history.current.future = [];
            latest.current.document = next;
            setDocument(next);
            setTick(tick => tick + 1);
            scheduleSave();
        },
        [scheduleSave],
    );

    const step = useCallback(
        (direction: 'undo' | 'redo') => {
            const { past, future } = history.current;
            const target = direction === 'undo' ? past.pop() : future.shift();
            if (!target) return;
            if (direction === 'undo') future.unshift(latest.current.document);
            else past.push(latest.current.document);
            latest.current.document = target;
            coalesce.current = null;
            setDocument(target);
            setTick(tick => tick + 1);
            scheduleSave();
        },
        [scheduleSave],
    );
    const undo = useCallback(() => step('undo'), [step]);
    const redo = useCallback(() => step('redo'), [step]);

    /** Saves now (before publishing or leaving). */
    const flush = useCallback(async () => {
        window.clearTimeout(timer.current);
        if (dirty.current || saving.current) await runSave();
        while (saving.current) await saving.current;
    }, [runSave]);

    /** Overwrites a newer draft with this editor's (the conflict's "Keep my changes"). */
    const keepMine = useCallback(async () => {
        setConflict(null);
        await runSave(true);
    }, [runSave]);

    const publish = useCallback(
        async (force = false) => {
            await flush();
            if (dirty.current) return { ok: false as const, errors: [] as LayoutWarning[] };
            const result = await publishLayout(latest.current.layoutId, latest.current.baseVersion, force);
            if (result.conflict) {
                setConflict({ ...result.conflict, kind: 'publish' });
                return { ok: false as const, errors: [] };
            }
            if (result.errors.length || !result.layout) {
                setWarnings(current => [
                    ...result.errors,
                    ...current.filter(
                        w => !result.errors.some(e => e.sectionId === w.sectionId && e.field === w.field),
                    ),
                ]);
                return { ok: false as const, errors: result.errors };
            }
            setConflict(null);
            latest.current.revision = result.layout.draftRevision;
            latest.current.baseVersion = result.layout.publishedVersion;
            setLayout(current => ({ ...result.layout!, draft: current.draft }));
            setWarnings(result.layout.warnings);
            return { ok: true as const, errors: [] };
        },
        [flush],
    );

    const restore = useCallback(
        async (version: number) => {
            await flush();
            const result = await restoreVersion(latest.current.layoutId, version);
            if (result.layout) reset(result.layout);
            return !!result.layout;
        },
        [flush, reset],
    );

    const discard = useCallback(async () => {
        window.clearTimeout(timer.current);
        while (saving.current) await saving.current;
        const result = await discardDraft(latest.current.layoutId);
        if (result.layout) reset(result.layout);
        return !!result.layout;
    }, [reset]);

    // Unsaved changes when the tab closes: ask first.
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (dirty.current || saving.current) event.preventDefault();
        };
        window.addEventListener('beforeunload', warn);
        return () => {
            window.removeEventListener('beforeunload', warn);
            window.clearTimeout(timer.current);
        };
    }, []);

    // Back online: save what's waiting.
    useEffect(() => {
        const online = () => {
            if (dirty.current) void runSave();
        };
        window.addEventListener('online', online);
        return () => window.removeEventListener('online', online);
    }, [runSave]);

    const hasChanges = useMemo(() => status !== 'saved' || layout.hasChanges, [status, layout.hasChanges]);

    return {
        layout,
        document,
        change,
        undo,
        redo,
        canUndo: history.current.past.length > 0,
        canRedo: history.current.future.length > 0,
        status,
        warnings,
        conflict,
        dismissConflict: () => setConflict(null),
        keepMine,
        reset,
        flush,
        publish,
        restore,
        discard,
        savedCount,
        hasChanges,
    };
}

export type LayoutEditor = ReturnType<typeof useLayoutEditor>;
