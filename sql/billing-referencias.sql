-- Limpieza de la tabla de líneas de Finanzas (`billing`).
--
-- 1) Cliente y recruiter como referencias reales: billing.client_id y
--    billing.recruiter_id. Los nombres en texto (client_name, recruiter_name)
--    NO se tocan: todas las pantallas siguen leyéndolos igual. Las referencias
--    se completan solas, por nombre, en cualquier alta o cambio de nombre
--    (trigger), así no hay que tocar el trigger del hire ni /api/hire-complete.
--    Si el nombre no coincide con un cliente/usuario (o coincide con varios),
--    la referencia queda vacía: nunca se adivina.
-- 2) Borrar una postulación del ATS ya no borra la línea contable de ese hire:
--    billing.application_id pasa de ON DELETE CASCADE a SET NULL (la línea
--    queda, desvinculada).
--
-- No cambia permisos. Es idempotente (se puede correr dos veces).
--
-- MARCHA ATRÁS:
--   drop trigger if exists billing_referencias_trg on public.billing;
--   drop function if exists public.billing_completar_referencias();
--   alter table public.billing drop column client_id, drop column recruiter_id;
--   (y para volver al borrado en cascada:)
--   alter table public.billing drop constraint billing_application_id_fkey,
--     add constraint billing_application_id_fkey foreign key (application_id)
--     references public.applications(id) on delete cascade;

begin;

alter table public.billing
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists recruiter_id uuid references public.users(id) on delete set null;

-- Un nombre solo se resuelve si apunta a UNA sola fila.
create or replace function public.billing_completar_referencias() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.client_name is distinct from old.client_name then
    new.client_id := (select case when count(*) = 1 then min(c.id::text)::uuid end
                        from public.clients c
                       where lower(trim(c.name)) = lower(trim(new.client_name)));
  end if;
  if tg_op = 'INSERT' or new.recruiter_name is distinct from old.recruiter_name then
    new.recruiter_id := (select case when count(*) = 1 then min(u.id::text)::uuid end
                           from public.users u
                          where lower(trim(u.name)) = lower(trim(new.recruiter_name)));
  end if;
  return new;
end $$;

drop trigger if exists billing_referencias_trg on public.billing;
create trigger billing_referencias_trg
  before insert or update of client_name, recruiter_name on public.billing
  for each row execute function public.billing_completar_referencias();

-- Completar lo que ya existe (los nombres no cambian).
update public.billing b
   set client_id = (select case when count(*) = 1 then min(c.id::text)::uuid end
                      from public.clients c
                     where lower(trim(c.name)) = lower(trim(b.client_name)))
 where b.client_id is null and b.client_name is not null;

update public.billing b
   set recruiter_id = (select case when count(*) = 1 then min(u.id::text)::uuid end
                         from public.users u
                        where lower(trim(u.name)) = lower(trim(b.recruiter_name)))
 where b.recruiter_id is null and b.recruiter_name is not null;

-- Borrar una postulación conserva la línea contable.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.billing'::regclass and contype = 'f'
              and confrelid = 'public.applications'::regclass
  loop
    execute format('alter table public.billing drop constraint %I', r.conname);
  end loop;
  alter table public.billing add constraint billing_application_id_fkey
    foreign key (application_id) references public.applications(id) on delete set null;
end $$;

commit;
