-- Cada hire genera su línea en Finanzas automáticamente.
--
-- Cuando una postulación pasa a 'hired', la base crea la línea en `billing`
-- (por_facturar) con lo que sabe: candidato, cliente, puesto, recruiter asignado
-- y start date si ya está. El modal del ATS después la completa por
-- /api/hire-complete (start date, salario y quién confirmó). Si el modal se
-- omite o se cierra, la línea igual quedó creada.
--
-- Es una red de seguridad que funciona se confirme el hire desde donde se
-- confirme. Es idempotente: el índice único parcial billing_application_unico
-- (application_id) impide duplicados.
--
-- MARCHA ATRÁS: drop trigger applications_hire_genera_linea on public.applications;
--               drop function public.billing_desde_hire();

create or replace function public.billing_desde_hire() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'hired' and old.status is distinct from 'hired' then
    insert into public.billing (application_id, candidate_name, client_name, position_role, recruiter_name, start_date, tipo_busqueda, estado)
    select new.id, c.name, cl.name, p.role, u.name, new.start_date,
           case when p.tipo in ('nueva', 'garantia') then p.tipo else 'nueva' end, 'por_facturar'
    from public.candidates c
    join public.positions p on p.id = new.position_id
    left join public.clients cl on cl.id = p.client_id
    left join public.users u on u.id = new.recruiter_id
    where c.id = new.candidate_id
    on conflict (application_id) where application_id is not null do nothing;
  end if;
  return new;
end $$;

drop trigger if exists applications_hire_genera_linea on public.applications;
create trigger applications_hire_genera_linea
  after update of status on public.applications
  for each row execute function public.billing_desde_hire();

-- Los hires que ya estaban confirmados y no tienen línea (ni por postulación ni
-- una línea importada del mismo cliente y candidato): se crean ahora. Quien
-- aparece como recruiter es quien confirmó el hire; si no hay historial, el asignado.
insert into public.billing (application_id, candidate_name, client_name, position_role, recruiter_name, start_date, tipo_busqueda, estado)
select a.id, c.name, cl.name, p.role,
       coalesce((select u2.name from public.status_history h join public.users u2 on u2.id = h.changed_by
                 where h.application_id = a.id and h.new_status = 'hired' order by h.changed_at desc limit 1), u.name),
       a.start_date, case when p.tipo in ('nueva', 'garantia') then p.tipo else 'nueva' end, 'por_facturar'
from public.applications a
join public.candidates c on c.id = a.candidate_id
join public.positions p on p.id = a.position_id
left join public.clients cl on cl.id = p.client_id
left join public.users u on u.id = a.recruiter_id
where a.status = 'hired'
  and not exists (select 1 from public.billing b where b.application_id = a.id)
  and not exists (select 1 from public.billing b where lower(trim(b.client_name)) = lower(trim(cl.name)) and lower(trim(b.candidate_name)) = lower(trim(c.name)))
on conflict (application_id) where application_id is not null do nothing;
