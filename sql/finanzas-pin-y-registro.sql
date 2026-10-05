-- Finanzas: PIN en el servidor + registro de cambios.
--
-- 1) app_settings: configuración del servidor, sin acceso anónimo. Guarda el
--    hash bcrypt del PIN de Finanzas ('finanzas_pin_hash'). El PIN inicial se
--    cargó a mano (no se commitea ni siquiera el hash: un PIN de 4 dígitos se
--    adivina desde su hash en segundos). Se cambia desde Finanzas.
-- 2) finanzas_log: quién cambió qué y cuándo en billing / facturas /
--    embedded_nomina*. Lo escribe api/owner-data.js; solo owner lo lee. Los
--    borrados guardan la fila completa.
--
-- Mismo patrón que client_secrets: RLS sin políticas, sin permisos para anon
-- ni authenticated, grant solo a service_role.

create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists finanzas_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  user_id   text,
  user_name text,
  tabla     text not null,
  accion    text not null,      -- crear | editar | estado | borrar
  row_id    text,
  antes     jsonb,
  despues   jsonb
);
create index if not exists finanzas_log_tabla_row_idx on finanzas_log (tabla, row_id, at desc);

alter table app_settings enable row level security;
alter table finanzas_log enable row level security;
revoke all on app_settings from anon, authenticated;
revoke all on finanzas_log from anon, authenticated;
grant all on app_settings to service_role;
grant all on finanzas_log to service_role;
grant usage, select on sequence finanzas_log_id_seq to service_role;

-- Rollback: drop table finanzas_log; drop table app_settings;
