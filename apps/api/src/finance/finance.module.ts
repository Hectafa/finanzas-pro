import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AttachmentsService } from './attachments.service';
import { CategoriesService } from './categories.service';
import {
  AccountsController,
  AttachmentsController,
  CategoriesController,
  LedgerController,
  TransactionsController,
} from './finance.controller';
import { LedgerService } from './ledger.service';
import { TransactionsService } from './transactions.service';

@Module({
  controllers: [
    AccountsController,
    CategoriesController,
    TransactionsController,
    AttachmentsController,
    LedgerController,
  ],
  providers: [
    LedgerService,
    AccountsService,
    CategoriesService,
    TransactionsService,
    AttachmentsService,
  ],
  exports: [LedgerService],
})
export class FinanceModule {}
