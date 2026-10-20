import { Settings, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardBody, CardHeader, PageHeader } from '../components/ui/misc';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';

export function HomePage() {
    const { messages: m } = useI18n();
    const { user, can } = useAuth();
    return (
        <>
            <PageHeader title={m.home.greeting(user?.name ?? '')} description={m.home.intro} />
            <div className="grid gap-4 md:grid-cols-2">
                {can('ReadSettings') && (
                    <Card>
                        <CardHeader title={m.home.setupTitle} />
                        <CardBody>
                            <p className="text-slate-700">{m.home.setupBody}</p>
                            <Link
                                to="/settings/store"
                                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-700 px-4 font-medium text-white hover:bg-teal-800"
                            >
                                <Settings className="size-4" aria-hidden />
                                {m.home.openSettings}
                            </Link>
                        </CardBody>
                    </Card>
                )}
                <Card>
                    <CardHeader title={m.home.comingTitle} />
                    <CardBody>
                        <p className="flex gap-2 text-slate-700">
                            <Sparkles className="mt-1 size-4 shrink-0 text-teal-700" aria-hidden />
                            {m.home.comingBody}
                        </p>
                    </CardBody>
                </Card>
            </div>
        </>
    );
}
