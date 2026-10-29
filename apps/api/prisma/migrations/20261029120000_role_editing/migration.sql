-- Edición y archivo de roles personalizados.
ALTER TABLE "roles"
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_by" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Un rol archivado libera su nombre para que pueda reutilizarse.
DROP INDEX roles_company_name_uq;
CREATE UNIQUE INDEX roles_company_name_uq ON roles (company_id, lower(name))
  WHERE company_id IS NOT NULL AND archived_at IS NULL;
