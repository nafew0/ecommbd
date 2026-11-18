import { LoaderCircle, RefreshCw } from 'lucide-react';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { cn } from '../../lib/cn';
import { useI18n } from '../../lib/i18n';
import { Button } from '../ui/button';

/**
 * The live preview (roadmap phase 15): the real storefront page with its draft, in a sandboxed
 * frame (scripts and its own origin, but no forms, pop-ups or navigating this page). Messages go
 * only to the storefront's origin and are accepted only from that frame and origin
 * (scripts/preview.ts on the storefront is the other side).
 *
 * Phone view is 390 px wide and tablet view 768 px (phase 57); computer view renders 1280 px
 * wide and is scaled down to fit.
 */

export type Device = 'phone' | 'tablet' | 'desktop';

export interface PreviewMessage {
    type: string;
    [key: string]: unknown;
}

export interface PreviewHandle {
    post(message: PreviewMessage): void;
}

interface PreviewFrameProps {
    src: string | null;
    device: Device;
    title: string;
    onMessage?(message: PreviewMessage): void;
    /** Percent of real size (phase 58), or null to fit the space. */
    zoom?: number | null;
    /** Says what "fit" comes to, in percent, for the zoom readout. */
    onFit?(percent: number): void;
}

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;
const TABLET_WIDTH = 768;

export const PreviewFrame = forwardRef<PreviewHandle, PreviewFrameProps>(function PreviewFrame(
    { src, device, title, onMessage, zoom = null, onFit },
    ref,
) {
    const { messages: m } = useI18n();
    const d = m.design;
    const frame = useRef<HTMLIFrameElement>(null);
    const area = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [attempt, setAttempt] = useState(0);
    const origin = src ? new URL(src, window.location.href).origin : null;
    const handler = useRef(onMessage);
    handler.current = onMessage;
    const readyRef = useRef(false);
    readyRef.current = ready;

    const post = useCallback(
        (message: PreviewMessage) => {
            if (!origin) return;
            frame.current?.contentWindow?.postMessage({ source: 'ecommbd-editor', ...message }, origin);
        },
        [origin],
    );
    useImperativeHandle(ref, () => ({ post }), [post]);

    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (!origin || event.origin !== origin || event.source !== frame.current?.contentWindow) return;
            const data = event.data as { source?: string } & PreviewMessage;
            if (data?.source !== 'ecommbd-preview') return;
            if (data.type === 'ready') {
                setReady(true);
                setFailed(false);
            }
            handler.current?.(data);
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
    }, [origin]);

    // A new address (another language, a retry): wait for the page to say it's ready.
    useEffect(() => {
        setReady(false);
        setFailed(false);
        if (!src) return;
        const timeout = window.setTimeout(() => {
            if (!readyRef.current) setFailed(true);
        }, 20_000);
        return () => window.clearTimeout(timeout);
    }, [src, attempt]);

    useLayoutEffect(() => {
        const element = area.current;
        if (!element) return;
        // Measured before the first paint, so the frame doesn't start tiny and grow.
        const box = element.getBoundingClientRect();
        setSize({ width: box.width, height: box.height });
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // Every view shrinks to fit a narrow window; the page inside keeps its real width.
    const handheld = device !== 'desktop';
    const frameWidth =
        device === 'desktop' ? DESKTOP_WIDTH : device === 'tablet' ? TABLET_WIDTH : PHONE_WIDTH;
    const fitScale = Math.max(0.3, Math.min(1, (size.width - (handheld ? 24 : 0)) / frameWidth));
    const scale = zoom ? zoom / 100 : fitScale;
    const fitPercent = Math.round(fitScale * 100);
    useEffect(() => {
        if (size.width) onFit?.(fitPercent);
        // Only when what "fit" comes to changes (not when the parent passes a new function).
    }, [fitPercent, size.width]);
    const tallest = device === 'tablet' ? 1024 : 844;
    const frameHeight = handheld ? Math.min((size.height - 32) / scale, tallest) : size.height / scale;

    return (
        <div ref={area} className={cn('relative h-full w-full', zoom ? 'overflow-auto' : 'overflow-clip')}>
            {src && (
                <div
                    className={cn(
                        // Clipped, not hidden: a hidden box can still be scrolled by a focus or a
                        // scroll-into-view inside the frame, which would slide the page out of view.
                        'absolute top-0 overflow-clip bg-surface transition-[width,height] duration-300',
                        device === 'phone'
                            ? 'top-4 rounded-[18px] shadow-2xl ring-8 ring-ink'
                            : device === 'tablet'
                              ? 'top-4 rounded-[12px] shadow-2xl ring-8 ring-ink'
                              : 'shadow-sm',
                    )}
                    style={{
                        width: frameWidth * scale,
                        height: frameHeight * scale,
                        left: handheld || zoom ? Math.max(0, (size.width - frameWidth * scale) / 2) : 0,
                    }}
                >
                    <iframe
                        key={attempt}
                        ref={frame}
                        src={src}
                        title={title}
                        sandbox="allow-scripts allow-same-origin"
                        referrerPolicy="same-origin"
                        className="block origin-top-left border-0 bg-surface"
                        style={{
                            width: frameWidth,
                            height: frameHeight,
                            transform: scale !== 1 ? `scale(${scale})` : undefined,
                        }}
                    />
                </div>
            )}
            {src && !ready && !failed && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-surface-muted/70"
                    role="status"
                >
                    <span className="flex items-center gap-2 rounded-md bg-surface px-4 py-2 text-sm text-ink-muted shadow">
                        <LoaderCircle className="size-4 animate-spin text-accent" aria-hidden />
                        {d.previewLoading}
                    </span>
                </div>
            )}
            {failed && (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-muted/80 p-6">
                    <div className="max-w-sm rounded-lg bg-surface p-5 text-center shadow">
                        <p className="mb-3 text-sm text-ink-muted">{d.previewFailed}</p>
                        <Button variant="secondary" size="sm" onClick={() => setAttempt(value => value + 1)}>
                            <RefreshCw className="size-4" aria-hidden />
                            {d.retry}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
});
