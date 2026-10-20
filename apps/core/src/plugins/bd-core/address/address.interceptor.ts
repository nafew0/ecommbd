import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { GqlExecutionContext, type GqlContextType } from '@nestjs/graphql';
import { UserInputError } from '@vendure/core';
import type { Observable } from 'rxjs';
import { BdAddressError, normalizeAddressInput } from './normalize-address';

/**
 * Where each mutation (Shop and Admin API) carries an address. Adding a mutation with an address?
 * List it here, or our checks are skipped for it.
 */
const ADDRESS_ARGS: Record<string, string[][]> = {
    createCustomerAddress: [['input']],
    updateCustomerAddress: [['input']],
    setOrderShippingAddress: [['input']],
    setOrderBillingAddress: [['input']],
    setDraftOrderShippingAddress: [['input']],
    setDraftOrderBillingAddress: [['input']],
    modifyOrder: [
        ['input', 'updateShippingAddress'],
        ['input', 'updateBillingAddress'],
    ],
};

/**
 * Runs `normalizeAddressInput` on address arguments before the resolver, so every API path (our
 * admin, the storefront, the Dashboard, imports through the API) gets the same checks. Errors come
 * back in the request's language (`?languageCode=bn`), with the code in the message key.
 */
@Injectable()
export class BdAddressInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType<GqlContextType>() === 'graphql') {
            const gql = GqlExecutionContext.create(context);
            const info = gql.getInfo<{ fieldName: string; parentType: { name: string } }>();
            const paths = info.parentType.name === 'Mutation' ? ADDRESS_ARGS[info.fieldName] : undefined;
            if (paths) {
                const args = gql.getArgs<Record<string, unknown>>();
                for (const path of paths) {
                    normalizeAt(args, path);
                }
            }
        }
        return next.handle();
    }
}

function normalizeAt(args: Record<string, unknown>, path: string[]) {
    const parent = path
        .slice(0, -1)
        .reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], args);
    const key = path[path.length - 1]!;
    const container = parent as Record<string, unknown> | undefined;
    const address = container?.[key];
    if (!address || typeof address !== 'object') {
        return;
    }
    try {
        container![key] = normalizeAddressInput(address);
    } catch (error) {
        if (error instanceof BdAddressError) {
            throw new UserInputError(`error.bd-address.${error.code}`);
        }
        throw error;
    }
}
