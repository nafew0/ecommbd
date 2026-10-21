import type { RiskLevel } from '@ecommbd/shared/fraud';
import { ShieldAlert } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { OrderRisk } from '../../lib/orders';
import { useDigits } from '../form/inputs';
import { Badge, type BadgeTone } from '../ui/misc';

const TONES: Record<RiskLevel, BadgeTone> = { low: 'green', medium: 'amber', high: 'red' };

/**
 * The order's risk score with its reasons (roadmap phase 11), e.g. "Risk 65 · 1 fake order before".
 * The server sends it only to staff with ReadRisk; low risk with no reasons shows nothing.
 */
export function RiskBadge({ risk, otpStatus }: { risk: OrderRisk | null; otpStatus?: string | null }) {
    const { messages: m } = useI18n();
    const digits = useDigits();
    const unverified = otpStatus === 'unverified';
    const shown = risk && risk.level !== 'low' ? risk : null;
    if (!shown && !unverified) return null;
    const reasons = (shown?.reasons ?? []).map(reason => m.risk.reasons[reason.code](reason.count ?? 0));
    return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
            {shown && (
                <Badge tone={TONES[shown.level]} title={m.risk.levels[shown.level]}>
                    <ShieldAlert className="size-3.5" aria-hidden />
                    {m.risk.label(digits(shown.score))}
                </Badge>
            )}
            {reasons.length > 0 && <span className="text-sm text-slate-700">{reasons.join(' · ')}</span>}
            {unverified && <Badge tone="orange">{m.risk.unverified}</Badge>}
        </span>
    );
}
