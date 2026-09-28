-- Auditoría de los 20 endpoints: api/login.js no tenía ningún límite de
-- intentos — alguien podía probar contraseñas para un email sin ningún
-- freno. Esta tabla guarda cada intento fallido (nunca los exitosos, ni la
-- contraseña probada) para que login.js pueda contar cuántos hubo por
-- email en los últimos minutos y cortar antes de comparar el hash si hay
-- demasiados.
--
-- RLS habilitado y sin ninguna política: mismo patrón que
-- lockdown-finance-tables.sql — el acceso directo con la clave anónima
-- queda denegado por default, y la service key de login.js (que ignora RLS
-- siempre) es la única que necesita escribir/leer acá.

create table if not exists login_attempts (
  id bigserial primary key,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists login_attempts_email_created_idx
  on login_attempts (email, created_at);

alter table login_attempts enable row level security;
