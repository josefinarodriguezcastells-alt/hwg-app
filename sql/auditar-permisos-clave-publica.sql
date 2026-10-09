-- SOLO LECTURA. Muestra todo lo que la clave pública (anon) y los usuarios con sesión de
-- Supabase (authenticated) pueden hacer en la base. Despues de cerrar-clave-publica-definitivo.sql
-- las tres listas tienen que dar vacías (null). Correr cada vez que se cree una tabla o función.
-- Ojo con la trampa: probar con `select=*` NO alcanza (los permisos por columna no se ven así);
-- por eso se mira el catálogo.
select json_build_object(
  'tablas_y_vistas_con_permisos', (select json_agg(json_build_object('nombre', c.relname, 'tipo', c.relkind::text,
      'anon_lee', has_any_column_privilege('anon', c.oid, 'select'),
      'anon_escribe', has_any_column_privilege('anon', c.oid, 'insert') or has_any_column_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'),
      'authenticated_lee', has_any_column_privilege('authenticated', c.oid, 'select'),
      'authenticated_escribe', has_any_column_privilege('authenticated', c.oid, 'insert') or has_any_column_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete')))
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p')
      and (has_any_column_privilege('anon', c.oid, 'select') or has_any_column_privilege('anon', c.oid, 'insert') or has_any_column_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete')
        or has_any_column_privilege('authenticated', c.oid, 'select') or has_any_column_privilege('authenticated', c.oid, 'insert') or has_any_column_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'))),
  'funciones_ejecutables', (select json_agg(p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'politicas_para_anon', (select json_agg(tablename || ': ' || policyname) from pg_policies
    where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles)))
) as permisos_de_la_clave_publica;
