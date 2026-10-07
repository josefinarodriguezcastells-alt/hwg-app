-- SOLO LECTURA. Muestra el estado de `billing` antes de correr billing-referencias.sql.
select json_build_object(
  'lineas', (select count(*) from public.billing),
  'application_id_nullable', (select is_nullable from information_schema.columns where table_schema='public' and table_name='billing' and column_name='application_id'),
  'ya_tiene_client_id', exists(select 1 from information_schema.columns where table_schema='public' and table_name='billing' and column_name='client_id'),
  'ya_tiene_recruiter_id', exists(select 1 from information_schema.columns where table_schema='public' and table_name='billing' and column_name='recruiter_id'),
  'fks_de_billing', (select json_agg(json_build_object('nombre', conname, 'a', confrelid::regclass::text, 'al_borrar', confdeltype)) from pg_constraint where conrelid='public.billing'::regclass and contype='f'),
  'clientes_con_nombre_repetido', (select count(*) from (select lower(trim(name)) from public.clients group by 1 having count(*)>1) x),
  'usuarios_con_nombre_repetido', (select count(*) from (select lower(trim(name)) from public.users group by 1 having count(*)>1) x),
  'lineas_cliente_sin_match_unico', (select count(*) from public.billing b where b.client_name is not null and (select count(*) from public.clients c where lower(trim(c.name))=lower(trim(b.client_name))) <> 1),
  'clientes_sin_match', (select json_agg(distinct b.client_name) from public.billing b where b.client_name is not null and (select count(*) from public.clients c where lower(trim(c.name))=lower(trim(b.client_name))) <> 1),
  'lineas_recruiter_sin_match_unico', (select count(*) from public.billing b where b.recruiter_name is not null and (select count(*) from public.users u where lower(trim(u.name))=lower(trim(b.recruiter_name))) <> 1),
  'recruiters_sin_match', (select json_agg(distinct b.recruiter_name) from public.billing b where b.recruiter_name is not null and (select count(*) from public.users u where lower(trim(u.name))=lower(trim(b.recruiter_name))) <> 1)
) as estado;
