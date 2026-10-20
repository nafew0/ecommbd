import { useQueryClient } from '@tanstack/react-query';
import {
    createContext,
    type FormEvent,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { adminApi, ApiError, type Language, onSessionExpired } from './api';
import { useI18n } from './i18n';

/**
 * Who is signed in, and what their role allows. The admin hides what a role can't do, but the
 * server is what enforces it: every request is checked there.
 */

export interface CurrentUser {
    id: string;
    identifier: string;
    name: string;
    permissions: string[];
}

type Status = 'loading' | 'signedIn' | 'signedOut';
export type SignInResult = 'ok' | 'invalid' | 'error';

interface AuthContextValue {
    status: Status;
    user: CurrentUser | null;
    signIn(username: string, password: string): Promise<SignInResult>;
    signOut(): Promise<void>;
    /** True when the role has this permission (SuperAdmin has all). */
    can(permission: string): boolean;
    /** Changes the admin language and remembers it for this staff member. */
    setLanguage(language: Language): void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ME = `
    query Me {
        me { id identifier channels { code permissions } }
        activeAdministrator { firstName lastName }
        language: getSettingsStoreValue(key: "bdAdmin.language")
    }
`;

const LOGIN = `
    mutation Login($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: true) {
            __typename
            ... on ErrorResult { errorCode message }
        }
    }
`;

const SAVE_LANGUAGE = `
    mutation SaveLanguage($value: JSON!) {
        setSettingsStoreValue(input: { key: "bdAdmin.language", value: $value }) { result }
    }
`;

interface MeResult {
    me: { id: string; identifier: string; channels: Array<{ code: string; permissions: string[] }> } | null;
    activeAdministrator: { firstName: string; lastName: string } | null;
    language: Language | null;
}

async function loadUser(): Promise<{ user: CurrentUser; language: Language | null } | null> {
    try {
        const result = await adminApi<MeResult>(ME);
        if (!result.me) return null;
        const channel =
            result.me.channels.find(candidate => candidate.code === '__default_channel__') ??
            result.me.channels[0];
        const name = [result.activeAdministrator?.firstName, result.activeAdministrator?.lastName]
            .filter(Boolean)
            .join(' ');
        return {
            user: {
                id: result.me.id,
                identifier: result.me.identifier,
                name: name || result.me.identifier,
                permissions: channel?.permissions ?? [],
            },
            language: result.language,
        };
    } catch (error) {
        if (error instanceof ApiError && error.code === 'FORBIDDEN') return null;
        throw error;
    }
}

export function AuthProvider({ children, onSignedOut }: { children: ReactNode; onSignedOut(): void }) {
    const queryClient = useQueryClient();
    const { language, setLanguage: setUiLanguage } = useI18n();
    const [status, setStatus] = useState<Status>('loading');
    const [user, setUser] = useState<CurrentUser | null>(null);
    const [reloginOpen, setReloginOpen] = useState(false);
    const waiting = useRef<Array<(signedIn: boolean) => void>>([]);
    /** A language picked on the sign-in page wins over the one saved earlier for this account. */
    const pickedBeforeSignIn = useRef(false);

    const applySession = useCallback(
        (session: Awaited<ReturnType<typeof loadUser>>) => {
            setUser(session?.user ?? null);
            setStatus(session ? 'signedIn' : 'signedOut');
            if (session?.language && session.language !== language) {
                setUiLanguage(session.language);
            }
            return session;
        },
        [language, setUiLanguage],
    );

    useEffect(() => {
        loadUser()
            .then(applySession)
            .catch(() => setStatus('signedOut'));
        // Only on first load: later changes come from signIn and signOut.
    }, []);

    // While signed in, a refused request because the session ended opens the sign-in dialog.
    useEffect(() => {
        if (status !== 'signedIn') {
            onSessionExpired(undefined);
            return;
        }
        onSessionExpired(
            () =>
                new Promise<boolean>(resolve => {
                    waiting.current.push(resolve);
                    setReloginOpen(true);
                }),
        );
        return () => onSessionExpired(undefined);
    }, [status]);

    const finishRelogin = useCallback((signedIn: boolean) => {
        setReloginOpen(false);
        const pending = waiting.current;
        waiting.current = [];
        pending.forEach(resolve => resolve(signedIn));
    }, []);

    const signIn = useCallback(
        async (username: string, password: string): Promise<SignInResult> => {
            try {
                const { login } = await adminApi<{ login: { __typename: string; errorCode?: string } }>(
                    LOGIN,
                    {
                        username: username.trim(),
                        password,
                    },
                );
                if (login.__typename !== 'CurrentUser') {
                    return login.errorCode === 'INVALID_CREDENTIALS_ERROR' ? 'invalid' : 'error';
                }
                const session = await loadUser();
                if (!session) return 'error';
                if (!session.language || pickedBeforeSignIn.current) {
                    // First sign-in, or a language picked on the sign-in page: save it for this account.
                    void adminApi(SAVE_LANGUAGE, { value: language }).catch(() => undefined);
                    session.language = language;
                }
                pickedBeforeSignIn.current = false;
                applySession(session);
                return 'ok';
            } catch {
                return 'error';
            }
        },
        [applySession, language],
    );

    const signOut = useCallback(async () => {
        await adminApi('mutation { logout { success } }').catch(() => undefined);
        queryClient.clear();
        setUser(null);
        setStatus('signedOut');
        onSignedOut();
    }, [queryClient, onSignedOut]);

    const setLanguage = useCallback(
        (next: Language) => {
            setUiLanguage(next);
            if (status === 'signedIn') {
                void adminApi(SAVE_LANGUAGE, { value: next }).catch(() => undefined);
            } else {
                pickedBeforeSignIn.current = true;
            }
        },
        [setUiLanguage, status],
    );

    const value = useMemo<AuthContextValue>(
        () => ({
            status,
            user,
            signIn,
            signOut,
            setLanguage,
            can: permission =>
                Boolean(user?.permissions.includes('SuperAdmin') || user?.permissions.includes(permission)),
        }),
        [status, user, signIn, signOut, setLanguage],
    );

    return (
        <AuthContext.Provider value={value}>
            {children}
            <ReloginDialog
                open={reloginOpen}
                identifier={user?.identifier ?? ''}
                onSignIn={signIn}
                onDone={finishRelogin}
                onGiveUp={() => {
                    finishRelogin(false);
                    void signOut();
                }}
            />
        </AuthContext.Provider>
    );
}

function ReloginDialog(props: {
    open: boolean;
    identifier: string;
    onSignIn(username: string, password: string): Promise<SignInResult>;
    onDone(signedIn: boolean): void;
    onGiveUp(): void;
}) {
    const { messages: m } = useI18n();
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        const result = await props.onSignIn(props.identifier, password);
        setBusy(false);
        if (result === 'ok') {
            setPassword('');
            setError(null);
            props.onDone(true);
        } else {
            setError(result === 'invalid' ? m.login.invalid : m.errors.generic);
        }
    };
    return (
        <Dialog
            open={props.open}
            onClose={props.onGiveUp}
            dismissible={!busy}
            title={m.login.sessionExpiredTitle}
            description={m.login.sessionExpiredBody}
        >
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-slate-700">{props.identifier}</p>
                <label className="block space-y-1">
                    <span className="font-medium">{m.login.password}</span>
                    <Input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        aria-invalid={Boolean(error)}
                        required
                        autoFocus
                    />
                </label>
                {error && (
                    <p role="alert" className="text-sm text-red-700">
                        {error}
                    </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={props.onGiveUp} disabled={busy}>
                        {m.login.signOut}
                    </Button>
                    <Button type="submit" loading={busy}>
                        {busy ? m.login.signingIn : m.login.signIn}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth needs <AuthProvider>');
    }
    return context;
}
