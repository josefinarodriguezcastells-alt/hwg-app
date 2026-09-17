-- Bloquea la escritura directa (clave anon) a la tabla `users`, sin romper
-- las pantallas que todavía la LEEN directo con la clave anon (dropdown de
-- recruiters, portal de cliente, reportes, dashboard, etc).
--
-- A diferencia de billing/facturas/embedded_nomina*/entidades_facturadoras
-- (ver lockdown-finance-tables.sql, que no dejan NINGUNA política para
-- 'anon'), acá SÍ hace falta una política de solo lectura para 'anon',
-- porque hay lecturas directas contra Supabase que no pasan por ningún
-- backend. Las escrituras (crear/editar/borrar usuario desde "Equipo") y el
-- login SÍ pasan por endpoints protegidos que usan la service_role key
-- (que ignora RLS siempre), así que no necesitan ninguna política acá:
--   - Login:        hwg-app/api/login.js       (usa SUPABASE_SERVICE_KEY)
--   - Crear/editar/borrar: hwg_ats/index.html vía secureTable('users')
--                    -> hwg-app/api/owner-data.js (usa SUPABASE_SERVICE_KEY)
--
-- Con RLS habilitado y una sola política de SELECT para 'anon', cualquier
-- INSERT/UPDATE/DELETE con la clave anon queda denegado por default.

-- Por las dudas haya quedado alguna política vieja y permisiva de otra
-- época (mismo patrón "allow_anon_select"/"anon_all" que se encontró en
-- billing/entidades), se borran todas las políticas existentes en `users`
-- antes de crear la única que necesitamos. Así el resultado final es
-- siempre el mismo sin importar qué había antes.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' LOOP
    EXECUTE format('DROP POLICY %I ON public.users', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_users" ON users
  FOR SELECT
  TO anon
  USING (true);

-- No se agrega ninguna política de INSERT/UPDATE/DELETE para 'anon' a
-- propósito: sin política, esas operaciones quedan denegadas.
