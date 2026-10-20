import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { Card, EmptyState } from '../components/ui/misc';
import { useI18n } from '../lib/i18n';

export function NotFoundPage() {
    const { messages: m } = useI18n();
    return (
        <Card>
            <EmptyState
                icon={<SearchX className="size-6" aria-hidden />}
                title={m.notFound.title}
                body={m.notFound.body}
                action={
                    <Link to="/" className="font-medium text-teal-800 underline">
                        {m.notFound.home}
                    </Link>
                }
            />
        </Card>
    );
}
