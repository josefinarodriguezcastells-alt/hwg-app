-- Fase 2, paso 2 de 2: con el frontend nuevo en producción y verificado, se
-- vacían las columnas de contacto de `clients`. Aborta si algo no quedó
-- copiado en las tablas bloqueadas.

do $$
begin
  if exists (
    select 1 from clients c
    where coalesce(btrim(c.stakeholder), '') not in ('', '[]')
      and not exists (select 1 from client_stakeholders s where s.client_id = c.id and s.stakeholder = c.stakeholder)
  ) then
    raise exception 'Hay stakeholders en clients sin copiar a client_stakeholders';
  end if;
  if exists (
    select 1 from clients c
    where (coalesce(c.contact_name, '') <> '' or coalesce(c.contact_info, '') <> '' or coalesce(c.contact, '') <> '' or coalesce(c.decisor_name, '') <> '')
      and not exists (select 1 from lead_contacts l where l.client_id = c.id)
  ) then
    raise exception 'Hay contactos en clients sin copiar a lead_contacts';
  end if;
end $$;

update clients set stakeholder = null, contact_name = null, contact_info = null, contact = null, decisor_name = null
where stakeholder is not null or contact_name is not null or contact_info is not null or contact is not null or decisor_name is not null;

-- Rollback (restaura desde las tablas bloqueadas):
--   update clients c set stakeholder = s.stakeholder from client_stakeholders s where s.client_id = c.id;
--   update clients c set contact_name = l.contact_name, contact_info = l.contact_info, decisor_name = l.decisor_name
--     from lead_contacts l where l.client_id = c.id;
