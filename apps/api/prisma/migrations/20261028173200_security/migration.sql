-- =====================================================================================
-- Seguridad de la Fase 1: restricciones adicionales, privilegios del rol de la API y
-- seguridad por fila (RLS) para aislar empresas.
--
-- Requisito: el rol `finanzas_app` debe existir antes de aplicar esta migración
-- (en local lo crea infra/postgres/init/01-roles.sql; en otros entornos, ver docs/despliegue.md).
-- =====================================================================================

-- ---------- Restricciones e índices que Prisma no expresa ----------
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
ALTER TABLE users ADD CONSTRAINT users_failed_login_nonneg CHECK (failed_login_count >= 0);
ALTER TABLE companies ADD CONSTRAINT companies_currency_iso CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE invitations ADD CONSTRAINT invitations_email_lowercase CHECK (email = lower(email));
ALTER TABLE roles ADD CONSTRAINT roles_system_consistency
  CHECK ((is_system AND company_id IS NULL AND key IS NOT NULL) OR (NOT is_system AND company_id IS NOT NULL));

CREATE UNIQUE INDEX roles_system_key_uq ON roles (key) WHERE company_id IS NULL;
CREATE UNIQUE INDEX roles_company_name_uq ON roles (company_id, lower(name)) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX branches_one_default_uq ON branches (company_id) WHERE is_default;
CREATE UNIQUE INDEX invitations_one_pending_uq ON invitations (company_id, email) WHERE status = 'PENDING';

-- ---------- Privilegios del rol de la API ----------
GRANT USAGE ON SCHEMA public TO finanzas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finanzas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO finanzas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finanzas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO finanzas_app;

-- La tabla de control de Prisma no existe en la base "shadow" que Prisma usa para validar.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM finanzas_app';
  END IF;
END $$;
-- Catálogo de permisos: solo lectura para la API (se sincroniza con el seed).
REVOKE INSERT, UPDATE, DELETE ON TABLE permissions FROM finanzas_app;
-- Bitácora: solo inserción y lectura. Nadie con el rol de la API puede alterarla.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM finanzas_app;

-- ---------- Contexto de seguridad por transacción ----------
-- La API ejecuta `set_config('app.company_id', ..., true)` al inicio de cada transacción.
-- Con `true` el valor es local a la transacción: no se filtra entre conexiones del pool.
CREATE FUNCTION app_current_company() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Solo para flujos de sistema explícitos (autenticación, aceptación de invitaciones).
-- En el código, únicamente DbService.system() lo activa.
CREATE FUNCTION app_rls_bypass() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.rls_bypass', true), '') = 'on' $$;

-- ---------- Políticas ----------
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_memberships_isolation ON company_memberships
  USING (app_rls_bypass() OR company_id = app_current_company() OR user_id = app_current_user())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_isolation ON companies
  USING (
    app_rls_bypass()
    OR id = app_current_company()
    OR id IN (SELECT m.company_id FROM company_memberships m
              WHERE m.user_id = app_current_user() AND m.status = 'ACTIVE')
  )
  WITH CHECK (app_rls_bypass() OR id = app_current_company());

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_isolation ON branches
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_isolation ON invitations
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_isolation ON audit_logs
  USING (app_rls_bypass() OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

-- Roles de sistema (company_id NULL) son visibles para todos; solo lectura desde una empresa.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_isolation ON roles
  USING (app_rls_bypass() OR company_id IS NULL OR company_id = app_current_company())
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_isolation ON role_permissions
  USING (app_rls_bypass() OR EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id))
  WITH CHECK (
    app_rls_bypass()
    OR EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id AND r.company_id = app_current_company())
  );
