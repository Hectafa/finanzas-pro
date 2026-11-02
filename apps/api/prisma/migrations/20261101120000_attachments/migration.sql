-- CreateTable
CREATE TABLE "transaction_attachments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "file_name" VARCHAR(160) NOT NULL,
    "mime_type" VARCHAR(60) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "duplicate_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by" UUID,

    CONSTRAINT "transaction_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_attachments_storage_key_key" ON "transaction_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "transaction_attachments_company_id_sha256_idx" ON "transaction_attachments"("company_id", "sha256");

-- CreateIndex
CREATE INDEX "transaction_attachments_transaction_id_idx" ON "transaction_attachments"("transaction_id");

-- AddForeignKey
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "financial_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_attachments" ADD CONSTRAINT "transaction_attachments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Coherencia e integridad ----------
ALTER TABLE "transaction_attachments"
  ADD CONSTRAINT "transaction_attachments_size_positive" CHECK (size_bytes > 0),
  ADD CONSTRAINT "transaction_attachments_sha256_hex" CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- Un comprobante no puede apuntar a un movimiento de otra empresa.
CREATE FUNCTION transaction_attachment_same_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM financial_transactions t WHERE t.id = NEW.transaction_id AND t.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Comprobante con empresa inconsistente' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER transaction_attachments_same_company BEFORE INSERT ON transaction_attachments
  FOR EACH ROW EXECUTE FUNCTION transaction_attachment_same_company();

-- ---------- Permisos del rol de la API ----------
-- Los metadatos no cambian: solo se puede retirar el comprobante. Nada se borra físicamente.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE transaction_attachments FROM finanzas_app;
GRANT UPDATE (removed_at, removed_by) ON TABLE transaction_attachments TO finanzas_app;

-- ---------- Seguridad por fila ----------
ALTER TABLE transaction_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY transaction_attachments_isolation ON transaction_attachments
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());
