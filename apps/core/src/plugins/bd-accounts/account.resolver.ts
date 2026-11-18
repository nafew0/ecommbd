import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, type ID, RequestContext } from '@vendure/core';
import { AccountService } from './account.service';
import { AccountSettingsService } from './account-settings.service';
import { manageAccountsPermission } from './constants';
import { ReportService } from './report.service';

/** Every method checks ManageAccounts. A class-level @Allow is ignored by Vendure. */
@Resolver()
export class AccountAdminResolver {
    constructor(
        private accounts: AccountService,
        private settings: AccountSettingsService,
        private reports: ReportService,
    ) {}

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdAccounts(
        @Ctx() ctx: RequestContext,
        @Args() args: { search?: string | null; skip?: number | null; take?: number | null },
    ) {
        return this.accounts.accounts(ctx, args);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdAccount(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.accounts.account(ctx, args.id);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdTransactions(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            accountId?: ID | null;
            source?: string | null;
            dateFrom?: string | null;
            dateTo?: string | null;
            skip?: number | null;
            take?: number | null;
        },
    ) {
        return this.accounts.transactions(ctx, args);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdTransactionsCsv(
        @Ctx() ctx: RequestContext,
        @Args()
        args: { accountId?: ID | null; source?: string | null; dateFrom?: string | null; dateTo?: string | null },
    ) {
        return this.accounts.transactionsCsv(ctx, args);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdExpenseHeads(@Ctx() ctx: RequestContext) {
        return this.accounts.heads(ctx);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdExpenses(
        @Ctx() ctx: RequestContext,
        @Args()
        args: { headId?: ID | null; dateFrom?: string | null; dateTo?: string | null; skip?: number | null; take?: number | null },
    ) {
        return this.accounts.expenses(ctx, args);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdExpense(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.accounts.expense(ctx, args.id);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdProfitAndLoss(@Ctx() ctx: RequestContext, @Args() args: { dateFrom: string; dateTo: string }) {
        return this.reports.profitAndLoss(ctx, args.dateFrom, args.dateTo);
    }

    @Query()
    @Allow(manageAccountsPermission.Permission)
    bdAccountSettings(@Ctx() ctx: RequestContext) {
        return this.settings.get(ctx);
    }

    @Mutation()
    @Allow(manageAccountsPermission.Permission)
    async saveBdAccount(@Ctx() ctx: RequestContext, @Args() args: { id?: ID | null; input: unknown }) {
        const saved = await this.accounts.saveAccount(ctx, args.id ?? null, args.input);
        return { account: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(manageAccountsPermission.Permission)
    async saveBdExpense(@Ctx() ctx: RequestContext, @Args() args: { id?: ID | null; input: unknown }) {
        const saved = await this.accounts.saveExpense(ctx, args.id ?? null, args.input);
        return { expense: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(manageAccountsPermission.Permission)
    async saveBdExpenseHead(@Ctx() ctx: RequestContext, @Args() args: { id?: ID | null; input: unknown }) {
        const saved = await this.accounts.saveHead(ctx, args.id ?? null, args.input);
        return { head: saved.value, errors: saved.errors };
    }

    @Mutation()
    @Allow(manageAccountsPermission.Permission)
    transferBdMoney(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.accounts.transfer(ctx, args.input);
    }

    @Mutation()
    @Allow(manageAccountsPermission.Permission)
    recordBdManualEntry(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        return this.accounts.manual(ctx, args.input);
    }

    @Mutation()
    @Allow(manageAccountsPermission.Permission)
    async updateBdAccountSettings(@Ctx() ctx: RequestContext, @Args() args: { input: unknown }) {
        const saved = await this.settings.update(ctx, args.input);
        return saved.ok ? { settings: saved.settings, errors: [] } : { settings: null, errors: saved.errors };
    }
}
