import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    Injector,
    Logger,
    RequestContext,
    RequestContextService,
    RoleService,
    SettingsStoreService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { BD_CORE_PLUGIN_OPTIONS, loggerCtx, SETTINGS_KEYS } from '../constants';
import type { BdCorePluginOptions } from '../types';
import { storeSettingsStep } from '../settings/store-settings.step';
import { coreStoreDefaults } from './core-steps';
import { registeredStoreDefaults, type StoreDefaultsStep } from './registry';

/** Which steps have run, stored in the settings store. */
type CompletedSteps = Record<string, { at: string }>;

export interface StoreDefaultsStepReport {
    id: string;
    description: string;
    /** `skipped`: already done before. `done`: ran now (notes say what it created or changed). */
    status: 'skipped' | 'done';
    notes: string[];
}

/** Any number: it only has to be the same in every process that runs the initializer. */
const ADVISORY_LOCK_KEY = 482_026_002;

/**
 * Sets up a new store with Bangladesh defaults (roadmap phase 02). Runs when the server starts and
 * on demand (`npm run store:init`). Safe to repeat:
 * - each step runs once and is recorded, so a merchant's later changes are never overwritten;
 * - each step runs in its own transaction and checks before creating, so an interrupted run
 *   continues where it stopped;
 * - a PostgreSQL advisory lock stops two processes starting together from both creating things.
 */
@Injectable()
export class StoreDefaultsService {
    constructor(
        private connection: TransactionalConnection,
        private settingsStore: SettingsStoreService,
        private requestContextService: RequestContextService,
        private roleService: RoleService,
        private moduleRef: ModuleRef,
        @Inject(BD_CORE_PLUGIN_OPTIONS) private options: BdCorePluginOptions,
    ) {}

    steps(): readonly StoreDefaultsStep[] {
        return [...coreStoreDefaults, storeSettingsStep, ...registeredStoreDefaults()];
    }

    async run(options: { force?: boolean } = {}): Promise<StoreDefaultsStepReport[]> {
        const force = options.force ?? false;
        const baseCtx = await this.superAdminContext();
        const injector = new Injector(this.moduleRef);
        const report: StoreDefaultsStepReport[] = [];
        for (const step of this.steps()) {
            const entry = await this.connection.withTransaction(baseCtx, async ctx => {
                await this.connection
                    .getRepository(ctx, User)
                    .query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
                const completed =
                    (await this.settingsStore.get<CompletedSteps>(ctx, SETTINGS_KEYS.storeDefaults)) ?? {};
                if (completed[step.id] && !force) {
                    return {
                        id: step.id,
                        description: step.description,
                        status: 'skipped' as const,
                        notes: [],
                    };
                }
                const notes = await step.run({ ctx, injector, options: this.options, force });
                const saved = await this.settingsStore.set(ctx, SETTINGS_KEYS.storeDefaults, {
                    ...completed,
                    [step.id]: { at: new Date().toISOString() },
                });
                if (!saved.result) {
                    throw new Error(`Could not record store-defaults step ${step.id}: ${saved.error}`);
                }
                return { id: step.id, description: step.description, status: 'done' as const, notes };
            });
            if (entry.status === 'done') {
                Logger.info(
                    `Store defaults: ${entry.id}${entry.notes.length ? `: ${entry.notes.join('; ')}` : ' (nothing needed)'}`,
                    loggerCtx,
                );
            }
            report.push(entry);
        }
        return report;
    }

    /** Steps run as the superadmin: Vendure only lets a user grant roles with permissions they hold. */
    private async superAdminContext(): Promise<RequestContext> {
        const superAdminRole = await this.roleService.getSuperAdminRole();
        const users = await this.connection.rawConnection.getRepository(User).find({
            where: { roles: { id: superAdminRole.id } },
            relations: { roles: { channels: true } },
        });
        const user = users.find(candidate => !candidate.deletedAt);
        if (!user) {
            throw new Error('Store defaults need the superadmin user, which does not exist yet');
        }
        return this.requestContextService.create({ apiType: 'admin', user });
    }
}
