import { code128Bars } from '@ecommbd/shared/barcode';

/**
 * A Code 128 barcode as SVG (roadmap phase 06). `moduleMm` is the width of the thinnest bar; 0.3 mm
 * or more scans reliably on cheap thermal and inkjet printers.
 */
export function Barcode({
    value,
    heightMm,
    moduleMm = 0.33,
}: {
    value: string;
    heightMm: number;
    moduleMm?: number;
}) {
    const { bars, modules } = code128Bars(value);
    return (
        <svg
            data-barcode={value}
            role="img"
            aria-label={value}
            viewBox={`0 0 ${modules} 10`}
            preserveAspectRatio="none"
            shapeRendering="crispEdges"
            style={{
                width: `${modules * moduleMm}mm`,
                height: `${heightMm}mm`,
                display: 'block',
                background: '#fff',
            }}
        >
            {bars.map(bar => (
                <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={10} fill="#000" />
            ))}
        </svg>
    );
}
