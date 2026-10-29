-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('CASH', 'BANK', 'DIGITAL_WALLET', 'TERMINAL');

-- CreateEnum
CREATE TYPE "CategoryNature" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'OWNER_CONTRIBUTION', 'OWNER_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING_REVIEW', 'POSTED', 'VOIDED');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "system_key" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "source_type" VARCHAR(32) NOT NULL,
    "source_id" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL,
    "reverses_entry_id" UUID,
    "memo" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "line_no" SMALLINT NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "debit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "financial_account_id" UUID,
    "category_id" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "institution" VARCHAR(80),
    "currency" CHAR(3) NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_categories" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nature" "CategoryNature" NOT NULL,
    "parent_id" UUID,
    "ledger_account_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "transaction_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transactions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "transaction_date" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "vat_rate" VARCHAR(4),
    "vat_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "account_id" UUID NOT NULL,
    "to_account_id" UUID,
    "category_id" UUID,
    "description" VARCHAR(200),
    "reference" VARCHAR(60),
    "counterparty" VARCHAR(120),
    "notes" VARCHAR(1000),
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" VARCHAR(300),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_company_id_code_key" ON "ledger_accounts"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_id_company_id_key" ON "ledger_accounts"("id", "company_id");

-- CreateIndex
CREATE INDEX "journal_entries_company_id_entry_date_idx" ON "journal_entries"("company_id", "entry_date");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_company_id_source_type_source_id_purpose_key" ON "journal_entries"("company_id", "source_type", "source_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_id_company_id_key" ON "journal_entries"("id", "company_id");

-- CreateIndex
CREATE INDEX "journal_lines_company_id_ledger_account_id_idx" ON "journal_lines"("company_id", "ledger_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_entry_id_line_no_key" ON "journal_lines"("entry_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_ledger_account_id_key" ON "financial_accounts"("ledger_account_id");

-- CreateIndex
CREATE INDEX "financial_accounts_company_id_idx" ON "financial_accounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_categories_ledger_account_id_key" ON "transaction_categories"("ledger_account_id");

-- CreateIndex
CREATE INDEX "transaction_categories_company_id_idx" ON "transaction_categories"("company_id");

-- CreateIndex
CREATE INDEX "financial_transactions_company_id_transaction_date_id_idx" ON "financial_transactions"("company_id", "transaction_date" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "financial_transactions_company_id_status_idx" ON "financial_transactions"("company_id", "status");

-- CreateIndex
CREATE INDEX "financial_transactions_company_id_created_by_idx" ON "financial_transactions"("company_id", "created_by");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "transaction_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================
-- Integridad y seguridad del libro contable (lo que Prisma no expresa)
-- =====================================================================================

-- ---------- Unicidad ----------
CREATE UNIQUE INDEX ledger_accounts_system_key_uq ON ledger_accounts (company_id, system_key)
  WHERE system_key IS NOT NULL;
CREATE UNIQUE INDEX financial_accounts_name_uq ON financial_accounts (company_id, lower(name))
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX transaction_categories_name_uq ON transaction_categories
  (company_id, nature, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  WHERE archived_at IS NULL;

-- ---------- Reglas de cada fila ----------
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_one_side CHECK (
  debit >= 0 AND credit >= 0 AND ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
ALTER TABLE financial_accounts ADD CONSTRAINT financial_accounts_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_amounts CHECK (
  amount > 0 AND vat_amount >= 0 AND vat_amount < amount
);
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_vat_rate CHECK (
  vat_rate IS NULL OR vat_rate IN ('16', '8', '0')
);
-- Cada tipo lleva exactamente los datos que necesita su asiento.
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_shape CHECK (
  CASE type
    WHEN 'INCOME' THEN category_id IS NOT NULL AND to_account_id IS NULL
    WHEN 'EXPENSE' THEN category_id IS NOT NULL AND to_account_id IS NULL
    WHEN 'TRANSFER' THEN category_id IS NULL AND to_account_id IS NOT NULL AND to_account_id <> account_id
      AND vat_rate IS NULL AND vat_amount = 0
    ELSE category_id IS NULL AND to_account_id IS NULL AND vat_rate IS NULL AND vat_amount = 0
  END
);
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_status_fields CHECK (
  (status = 'VOIDED') = (voided_at IS NOT NULL)
  AND (status <> 'POSTED' OR posted_at IS NOT NULL)
);

-- ---------- Coherencia de empresa en las líneas ----------
-- Una línea no puede apuntar a un asiento o cuenta contable de otra empresa.
CREATE FUNCTION journal_line_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.id = NEW.entry_id AND e.company_id = NEW.company_id)
     OR NOT EXISTS (SELECT 1 FROM ledger_accounts a WHERE a.id = NEW.ledger_account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'Línea de asiento con empresa inconsistente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_lines_same_company BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_line_same_company();

-- ---------- Partida doble: cada asiento cuadra ----------
-- Se verifica al final de la transacción (DEFERRABLE), cuando ya se insertaron todas las líneas.
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  total_debit numeric;
  total_credit numeric;
  line_count int;
BEGIN
  -- IF (no CASE): PL/pgSQL resolvería NEW.entry_id también para filas de journal_entries.
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSE
    target := NEW.entry_id;
  END IF;
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0), COUNT(*)
    INTO total_debit, total_credit, line_count
    FROM journal_lines WHERE entry_id = target;
  IF line_count < 2 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'Asiento % no cuadra (cargos %, abonos %, líneas %)', target, total_debit, total_credit, line_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- ---------- Privilegios: el libro es append-only para la API ----------
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE journal_entries, journal_lines FROM finanzas_app;
-- Nada financiero se borra físicamente: se archiva o se anula.
REVOKE DELETE, TRUNCATE ON TABLE ledger_accounts, financial_accounts, transaction_categories, financial_transactions
  FROM finanzas_app;

-- ---------- Seguridad por fila ----------
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_accounts_isolation ON ledger_accounts
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY journal_entries_isolation ON journal_entries
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY journal_lines_isolation ON journal_lines
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE financial_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_accounts_isolation ON financial_accounts
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY transaction_categories_isolation ON transaction_categories
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_transactions_isolation ON financial_transactions
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());
