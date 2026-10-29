import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';
import {
  AccountsController,
  CategoriesController,
  LedgerController,
  TransactionsController,
} from './finance.controller';
import { LedgerService } from './ledger.service';
import { TransactionsService } from './transactions.service';

@Module({
  controllers: [AccountsController, CategoriesController, TransactionsController, LedgerController],
  providers: [LedgerService, AccountsService, CategoriesService, TransactionsService],
  exports: [LedgerService],
})
export class FinanceModule {}
