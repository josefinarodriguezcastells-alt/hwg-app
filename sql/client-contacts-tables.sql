-- Fase 2 de la auditoría de claves públicas: los contactos de clientes y
-- leads (mails, celulares, nombres de decisores) vivían en columnas de
-- `clients`, legible con la clave anónima del frontend. Se mueven a dos
-- tablas con RLS y SIN políticas (solo la service key de api/ entra), mismo
-- patrón que client_secrets (Fase 1b).
--
-- - client_stakeholders: los stakeholders del cliente (JSON con nombre y
--   mail). Los recruiters los necesitan para avisar presentaciones, así que
--   owner-data los deja leer/escribir a owner y recruiter.
-- - lead_contacts: contacto comercial de un lead (nombre, mail/celular,
--   decisor, otros contactos). Solo owner: Leads es del owner.
--
-- Paso 1 de 2 (este archivo, aditivo): crea las tablas y copia los datos.
-- Las columnas de `clients` quedan intactas hasta que el frontend nuevo
-- esté en producción — ver client-contacts-null-columns.sql.

create table if not exists client_stakeholders (
  client_id   uuid primary key references clients(id) on delete cascade,
  stakeholder text,
  updated_at  timestamptz not null default now()
);

create table if not exists lead_contacts (
  client_id        uuid primary key references clients(id) on delete cascade,
  contact_name     text,
  contact_info     text,
  decisor_name     text,
  otros_contactos  text,
  updated_at       timestamptz not null default now()
);

alter table client_stakeholders enable row level security;
alter table lead_contacts enable row level security;
revoke all on client_stakeholders from anon, authenticated;
revoke all on lead_contacts from anon, authenticated;
-- Supabase ya no da permisos automáticos a las tablas nuevas.
grant all on client_stakeholders to service_role;
grant all on lead_contacts to service_role;

insert into client_stakeholders (client_id, stakeholder)
select id, stakeholder from clients
where stakeholder is not null and btrim(stakeholder) <> '' and btrim(stakeholder) <> '[]'
on conflict (client_id) do update set stakeholder = excluded.stakeholder, updated_at = now();

insert into lead_contacts (client_id, contact_name, contact_info, decisor_name)
select id, nullif(contact_name, ''), coalesce(nullif(contact_info, ''), nullif(contact, '')), nullif(decisor_name, '')
from clients
where coalesce(contact_name, '') <> '' or coalesce(contact_info, '') <> '' or coalesce(contact, '') <> '' or coalesce(decisor_name, '') <> ''
on conflict (client_id) do update set
  contact_name = excluded.contact_name, contact_info = excluded.contact_info,
  decisor_name = excluded.decisor_name, updated_at = now();

-- Rollback (tablas nuevas, `clients` sigue intacta en este paso):
--   drop table client_stakeholders; drop table lead_contacts;
