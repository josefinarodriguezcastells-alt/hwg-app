-- Cierre definitivo de lo que la clave pública (anon / authenticated) puede hacer.
-- Auditoría del 9/10/2026. Se puede correr más de una vez.
--
-- Qué cierra:
-- 1. La tabla `users`: la política "anon_select_users_sin_password" y los permisos de
--    tabla. Fue una excepción a propósito del 29/9 para que las pantallas del ATS
--    pudieran leer nombres de recruiters con la clave pública. Desde que el ATS lee la
--    base por el servidor (lib/dbProxy.js) nadie la usa, y dejaba leer id, nombre,
--    email y rol de todos los usuarios.
-- 2. Cinco tablas que conservaban permisos sueltos.
-- 3. Las FUNCIONES del esquema public. Una función en Postgres trae permiso de
--    ejecución para PUBLIC (todos) y `revoke ... from anon` NO lo quita: por eso
--    record_login_attempt y clear_login_attempts seguían ejecutables con la clave
--    pública (permitía borrar el propio contador de intentos y esquivar el límite).
--    Solo las ejecuta el servidor (service_role).
--
-- No afecta al ATS: el servidor usa la clave de servicio, que no depende de nada de esto.
--
-- MARCHA ATRÁS (solo si algo se rompiera, no debería):
--   grant select (id, name, email, role) on public.users to anon, authenticated;
--   create policy "anon_select_users_sin_password" on public.users for select to anon using (true);

begin;

drop policy if exists "anon_select_users_sin_password" on public.users;
drop policy if exists "anon_select_users" on public.users;
revoke all on table public.users from anon, authenticated;

revoke all on table public.login_attempts, public.notifications, public.outreach_logs,
  public.prefilter_questions, public.prefilter_responses from anon, authenticated;

do $$
declare r record;
begin
  -- Vistas y tablas que hubieran quedado con permisos para la clave pública.
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p')
              and (has_any_column_privilege('anon', c.oid, 'select') or has_any_column_privilege('authenticated', c.oid, 'select')
                   or has_table_privilege('anon', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'delete'))
  loop
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
  end loop;

  -- Funciones propias del esquema public (se saltean las de extensiones).
  for r in select p.oid::regprocedure as firma from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.firma);
    execute format('grant execute on function %s to service_role', r.firma);
  end loop;
end $$;

commit;
