-- Un usuario debe ver los roles (incluidos los personalizados) de sus propias membresías,
-- p. ej. al listar "mis empresas" sin una empresa activa. Sin esto, Prisma no puede incluir
-- el rol de una membresía con rol personalizado.
DROP POLICY roles_isolation ON roles;
CREATE POLICY roles_isolation ON roles
  USING (
    app_rls_bypass()
    OR company_id IS NULL
    OR company_id = app_current_company()
    OR id IN (SELECT m.role_id FROM company_memberships m WHERE m.user_id = app_current_user())
  )
  WITH CHECK (app_rls_bypass() OR company_id = app_current_company());
