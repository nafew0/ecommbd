import swc from 'unplugin-swc';

/**
 * Vendure plugins use TypeScript decorators with emitted metadata, which Vitest's default
 * transformer can't compile, so tests go through SWC (as in Vendure's testing guide).
 */
export const decoratorPlugin = swc.vite({
    jsc: {
        transform: {
            // https://github.com/vendurehq/vendure/issues/2099
            useDefineForClassFields: false,
        },
    },
});
