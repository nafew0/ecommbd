import { LegacyOrders } from '../components/legacy-orders';
import { PageHeader } from '../components/ui/misc';
import { useI18n } from '../lib/i18n';

/**
 * Orders imported from WooCommerce (Orders → WooCommerce orders). They are read-only history
 * (roadmap M5, decision b), kept apart from live orders so they never touch stock, couriers or
 * messages; this page is where staff find them. Each customer's page lists theirs too.
 */
export function WooOrdersPage() {
    const { messages } = useI18n();
    const f = messages.migration.flow;
    return (
        <>
            <PageHeader title={f.ordersTitle} description={f.ordersIntro} />
            <LegacyOrders pageSize={25} showHeader={false} />
        </>
    );
}
