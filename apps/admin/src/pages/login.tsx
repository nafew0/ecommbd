import { Eye, EyeOff } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Alert } from '../components/ui/misc';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { LanguageSwitch } from '../layout/language-switch';

export function LoginPage() {
    const { messages: m } = useI18n();
    const { status, signIn } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const from = (location.state as { from?: string } | null)?.from ?? '/';

    if (status === 'signedIn') {
        return <Navigate to={from} replace />;
    }

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await signIn(username, password);
        setBusy(false);
        if (result === 'ok') {
            navigate(from, { replace: true });
        } else {
            setError(result === 'invalid' ? m.login.invalid : m.errors.network);
        }
    };

    return (
        <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10">
            <div className="mb-6 flex w-full max-w-sm justify-end">
                <LanguageSwitch />
            </div>
            <main className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <h1 className="text-xl font-semibold">{m.login.title}</h1>
                <p className="mt-1 mb-6 text-slate-600">{m.login.subtitle}</p>
                <form onSubmit={submit} className="space-y-4" noValidate>
                    <label className="block space-y-1.5">
                        <span className="font-medium">{m.login.username}</span>
                        <Input
                            name="username"
                            autoComplete="username"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={username}
                            onChange={event => setUsername(event.target.value)}
                            required
                            autoFocus
                        />
                    </label>
                    <label className="block space-y-1.5">
                        <span className="font-medium">{m.login.password}</span>
                        <div className="relative">
                            <Input
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                autoComplete="current-password"
                                value={password}
                                onChange={event => setPassword(event.target.value)}
                                className="pr-11"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(value => !value)}
                                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500"
                                aria-label={showPassword ? m.login.hidePassword : m.login.showPassword}
                            >
                                {showPassword ? (
                                    <EyeOff className="size-4" aria-hidden />
                                ) : (
                                    <Eye className="size-4" aria-hidden />
                                )}
                            </button>
                        </div>
                    </label>
                    {error && <Alert tone="error">{error}</Alert>}
                    <Button
                        type="submit"
                        className="w-full justify-center"
                        loading={busy}
                        disabled={!username || !password}
                    >
                        {busy ? m.login.signingIn : m.login.signIn}
                    </Button>
                </form>
            </main>
        </div>
    );
}
