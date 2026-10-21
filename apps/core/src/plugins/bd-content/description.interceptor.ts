import { looksLikeHtml, sanitizeRichText } from '@ecommbd/shared';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import type { Observable } from 'rxjs';

/** Mutations whose `input` (or list of inputs) carries `translations[].description`. */
const DESCRIPTION_MUTATIONS = new Set([
    'createProduct',
    'updateProduct',
    'updateProducts',
    'createCollection',
    'updateCollection',
    'updateCollections',
]);

/**
 * Sanitizes product and category descriptions on save, whoever saves them (our admin, the
 * Dashboard, an import through the API). Plain text (phase 05's form) is left exactly as typed;
 * only HTML is cleaned. The storefront sanitizes again when it renders.
 */
@Injectable()
export class DescriptionSanitizerInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<GqlContextType>() === 'graphql') {
            const gql = GqlExecutionContext.create(context);
            const info = gql.getInfo<{ fieldName: string; parentType: { name: string } }>();
            if (info.parentType.name === 'Mutation' && DESCRIPTION_MUTATIONS.has(info.fieldName)) {
                const { input } = gql.getArgs<{ input?: unknown }>();
                for (const item of Array.isArray(input) ? input : [input]) sanitizeTranslations(item);
            }
        }
        return next.handle();
    }
}

function sanitizeTranslations(input: unknown) {
    const translations = (input as { translations?: unknown } | undefined)?.translations;
    if (!Array.isArray(translations)) return;
    for (const translation of translations as Array<{ description?: unknown }>) {
        if (typeof translation?.description === 'string' && looksLikeHtml(translation.description)) {
            translation.description = sanitizeRichText(translation.description);
        }
    }
}
