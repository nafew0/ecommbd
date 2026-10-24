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
function Protected({ bare = false }: { bare?: boolean }) {
    const { status } = useAuth();
    const location = useLocation();
    if (status === 'loading') return <Loading />;
    if (status === 'signedOut') {
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    }
    // Print views have no menu: just the documents and a toolbar.
    return bare ? <Outlet /> : <AppLayout />;
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
                    path: '/print',
                    element: <Protected bare />,
                    children: [
                        {
                            index: true,
                            lazy: () =>
                                import('./pages/print').then(module => ({ Component: module.PrintPage })),
                        },
                    ],
                },
                {
                    // Full-screen editors (phase 15): the page editor and the theme, with their own top bar.
                    path: '/store',
                    element: <Protected bare />,
                    children: [
                        {
                            path: 'design/:kind/:pageId?',
                            lazy: () =>
                                import('./pages/page-editor').then(module => ({
                                    Component: module.PageEditorPage,
                                })),
                        },
                        {
                            path: 'theme',
                            lazy: () =>
                                import('./pages/theme-editor').then(module => ({
                                    Component: module.ThemeEditorPage,
                                })),
                        },
                    ],
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
                            path: 'orders/phone',
                            lazy: () =>
                                import('./pages/phone-order').then(module => ({
                                    Component: module.PhoneOrderPage,
                                })),
                        },
                        {
                            path: 'products',
                            lazy: () =>
                                import('./pages/products').then(module => ({
                                    Component: module.ProductsPage,
                                })),
                        },
                        {
                            path: 'products/categories',
                            lazy: () =>
                                import('./pages/categories').then(module => ({
                                    Component: module.CategoriesPage,
                                })),
                        },
                        {
                            path: 'products/stock',
                            lazy: () =>
                                import('./pages/stock').then(module => ({ Component: module.StockPage })),
                        },
                        {
                            path: 'products/:id',
                            lazy: () =>
                                import('./pages/product-form').then(module => ({
                                    Component: module.ProductFormPage,
                                })),
                        },
                        {
                            path: 'orders/payments',
                            lazy: () =>
                                import('./pages/verify-payments').then(module => ({
                                    Component: module.VerifyPaymentsPage,
                                })),
                        },
                        {
                            path: 'marketing/tracking',
                            lazy: () =>
                                import('./pages/meta-tracking').then(module => ({
                                    Component: module.MetaTrackingPage,
                                })),
                        },
                        {
                            path: 'orders/unmapped-addresses',
                            lazy: () =>
                                import('./pages/unmapped-addresses').then(module => ({
                                    Component: module.UnmappedAddressesPage,
                                })),
                        },
                        {
                            path: 'settings/couriers',
                            lazy: () =>
                                import('./pages/courier-settings').then(module => ({
                                    Component: module.CourierSettingsPage,
                                })),
                        },
                        {
                            path: 'orders/payment-reviews',
                            lazy: () =>
                                import('./pages/payment-reviews').then(module => ({
                                    Component: module.PaymentReviewsPage,
                                })),
                        },
                        {
                            path: 'settings/online-payments',
                            lazy: () =>
                                import('./pages/online-payment-settings').then(module => ({
                                    Component: module.OnlinePaymentSettingsPage,
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
                            path: 'settings/invoice',
                            lazy: () =>
                                import('./pages/print-settings').then(module => ({
                                    Component: module.PrintSettingsPage,
                                })),
                        },
                        {
                            path: 'settings/payments',
                            lazy: () =>
                                import('./pages/payment-settings').then(module => ({
                                    Component: module.PaymentSettingsPage,
                                })),
                        },
                        {
                            path: 'settings/fraud',
                            lazy: () =>
                                import('./pages/fraud-settings').then(module => ({
                                    Component: module.FraudSettingsPage,
                                })),
                        },
                        {
                            path: 'orders/incomplete',
                            lazy: () =>
                                import('./pages/incomplete-orders').then(module => ({
                                    Component: module.IncompleteOrdersPage,
                                })),
                        },
                        {
                            path: 'customers/blocked',
                            lazy: () =>
                                import('./pages/block-list').then(module => ({
                                    Component: module.BlockListPage,
                                })),
                        },
                        {
                            path: 'settings/sms',
                            lazy: () =>
                                import('./pages/sms-settings').then(module => ({
                                    Component: module.SmsSettingsPage,
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
                            path: 'store/pages',
                            lazy: () =>
                                import('./pages/content-pages').then(module => ({
                                    Component: module.ContentPagesPage,
                                })),
                        },
                        {
                            path: 'sales-pages',
                            lazy: () =>
                                import('./pages/sales-pages').then(module => ({
                                    Component: module.SalesPagesPage,
                                })),
                        },
                        {
                            path: 'orders/campaigns',
                            lazy: () =>
                                import('./pages/order-campaigns').then(module => ({
                                    Component: module.OrderCampaignsPage,
                                })),
                        },
                        {
                            path: 'store/pages/:id',
                            lazy: () =>
                                import('./pages/content-page-edit').then(module => ({
                                    Component: module.ContentPageEditPage,
                                })),
                        },
                        {
                            path: 'store/menus',
                            lazy: () =>
                                import('./pages/content-menus').then(module => ({
                                    Component: module.ContentMenusPage,
                                })),
                        },
                        {
                            path: 'store/search',
                            lazy: () =>
                                import('./pages/search-settings').then(module => ({
                                    Component: module.SearchSettingsPage,
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
