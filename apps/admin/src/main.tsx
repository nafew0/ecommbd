import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/600.css';
import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { PageSkeleton } from './components/ui/misc';
import { AppLayout } from './layout/app-layout';
import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { ConfirmProvider } from './lib/confirm';
import { I18nProvider } from './lib/i18n';
import { ToastProvider } from './lib/toast';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Don't retry what will fail again (permissions, validation); do retry flaky mobile data.
            retry: (count, error) => count < 2 && !(error instanceof ApiError && error.code === 'FORBIDDEN'),
        },
    },
});

function Loading() {
    return (
        <div className="mx-auto max-w-5xl p-6">
            <PageSkeleton />
        </div>
    );
}

/** Signed-in pages: wait for the session check, then show the app or go to sign-in. */
function Protected() {
    const { status } = useAuth();
    const location = useLocation();
    if (status === 'loading') return <Loading />;
    if (status === 'signedOut') {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }
    return <AppLayout />;
}

// Each screen is its own chunk, loaded when first opened: the first load stays small on mobile data.
const router = createBrowserRouter(
    [
        {
            element: <Providers />,
            hydrateFallbackElement: <Loading />,
            children: [
                {
                    path: '/login',
                    lazy: () => import('./pages/login').then(module => ({ Component: module.LoginPage })),
                },
                {
                    path: '/',
                    element: <Protected />,
                    children: [
                        {
                            index: true,
                            lazy: () =>
                                import('./pages/home').then(module => ({ Component: module.HomePage })),
                        },
                        {
                            path: 'orders',
                            lazy: () =>
                                import('./pages/orders').then(module => ({ Component: module.OrdersPage })),
                        },
                        {
                            path: 'orders/confirm',
                            lazy: () =>
                                import('./pages/confirm-orders').then(module => ({
                                    Component: module.ConfirmOrdersPage,
                                })),
                        },
                        {
                            path: 'orders/:id',
                            lazy: () =>
                                import('./pages/order-detail').then(module => ({
                                    Component: module.OrderDetailPage,
                                })),
                        },
                        {
                            path: 'settings/orders',
                            lazy: () =>
                                import('./pages/order-settings').then(module => ({
                                    Component: module.OrderSettingsPage,
                                })),
                        },
                        {
                            path: 'settings/delivery',
                            lazy: () =>
                                import('./pages/delivery-settings').then(module => ({
                                    Component: module.DeliverySettingsPage,
                                })),
                        },
                        {
                            path: 'customers',
                            lazy: () =>
                                import('./pages/customers').then(module => ({
                                    Component: module.CustomersPage,
                                })),
                        },
                        {
                            path: 'customers/:id',
                            lazy: () =>
                                import('./pages/customer-detail').then(module => ({
                                    Component: module.CustomerDetailPage,
                                })),
                        },
                        {
                            path: 'settings/store',
                            lazy: () =>
                                import('./pages/store-settings').then(module => ({
                                    Component: module.StoreSettingsPage,
                                })),
                        },
                        {
                            path: 'ui-kit',
                            lazy: () =>
                                import('./pages/ui-kit').then(module => ({ Component: module.UiKitPage })),
                        },
                        {
                            path: '*',
                            lazy: () =>
                                import('./pages/not-found').then(module => ({
                                    Component: module.NotFoundPage,
                                })),
                        },
                    ],
                },
            ],
        },
    ],
    { basename: '/admin' },
);

/** Providers that need the router (sign-out navigates to the sign-in page). */
function Providers() {
    return (
        <AuthProvider onSignedOut={() => void router.navigate('/login', { replace: true })}>
            <Outlet />
        </AuthProvider>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                <ToastProvider>
                    <ConfirmProvider>
                        <RouterProvider router={router} />
                    </ConfirmProvider>
                </ToastProvider>
            </I18nProvider>
        </QueryClientProvider>
    </StrictMode>,
);
