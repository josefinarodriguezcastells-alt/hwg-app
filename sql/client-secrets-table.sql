-- Fase 1b de la auditoría de claves públicas: los PIN de los portales de
-- clientes vivían en clients.portal_pin, y `clients` se puede leer con la
-- clave anónima (la que está en el bundle del frontend) — cualquiera podía
-- pedir todos los PIN de todos los clientes sin pasar por el portal.
--
-- Esta tabla guarda el PIN aparte, con RLS habilitado y SIN ninguna
-- política: la clave anónima no ve nada, solo la service key (los
-- endpoints de api/) entra. Mismo patrón que las tablas de Finanzas.
--
-- Paso 1 de 2 (este archivo, aditivo, no rompe nada): crea la tabla y copia
-- los PIN actuales. clients.portal_pin queda intacto hasta que el servidor
-- y el frontend nuevos estén en producción — ver client-secrets-null-pin.sql.

create table if not exists client_secrets (
  client_id  uuid primary key references clients(id) on delete cascade,
  portal_pin text not null,
  updated_at timestamptz not null default now()
);

alter table client_secrets enable row level security;
revoke all on client_secrets from anon, authenticated;
-- Supabase ya no da permisos automáticos a las tablas nuevas: sin esto el
-- servidor (service_role) tampoco podía leerla ("permission denied").
grant all on client_secrets to service_role;

insert into client_secrets (client_id, portal_pin)
select id, portal_pin from clients
where portal_pin is not null and portal_pin <> ''
on conflict (client_id) do update set portal_pin = excluded.portal_pin, updated_at = now();

-- Rollback (la tabla es nueva, no hay nada que restaurar en `clients`):
--   drop table client_secrets;
