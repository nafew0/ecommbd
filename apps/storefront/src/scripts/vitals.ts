/**
 * The speed beacon's loader (roadmap phase 17). Every visitor of a page with the beacon downloads
 * only this: it decides first whether this visit is sampled, and only a sampled visit loads
 * web-vitals (a separate file, fetched on demand). Each measurement is sent once with
 * `sendBeacon`, which survives the page closing. Nothing about the visitor is sent: the metric,
 * its value, web-vitals' random ID for this page view, and the kind of page.
 */
const marker = document.querySelector<HTMLElement>('[data-speed-sample]');
if (marker && Math.random() < Number(marker.dataset.speedSample)) {
    const route = marker.dataset.speedRoute ?? 'other';
    void import('web-vitals').then(({ onCLS, onINP, onLCP }) => {
        const send = ({ id, name, value }: { id: string; name: string; value: number }) => {
            const body = JSON.stringify({ metricId: id, name, value, route });
            navigator.sendBeacon('/cache-metrics', new Blob([body], { type: 'application/json' }));
        };
        onLCP(send);
        onINP(send);
        onCLS(send);
    });
}
