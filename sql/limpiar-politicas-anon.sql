-- Limpieza final de seguridad (9/10/2026).
-- Después de cerrar-clave-publica-definitivo.sql la clave pública ya no tiene permisos,
-- pero quedaban reglas viejas (policies) escritas para "anon"/"public" en ~18 tablas.
-- No hacían nada sin permisos, pero si alguien vuelve a dar un permiso por error,
-- esas reglas lo dejarían pasar. Las sacamos, y nos aseguramos de que toda tabla
-- tenga la protección por filas activada.
-- El servidor del ATS usa service_role (se saltea estas reglas), no se afecta.
-- Se puede correr más de una vez sin problema.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and ('anon' = any(roles) or 'public' = any(roles))
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;

  for r in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
      and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;
