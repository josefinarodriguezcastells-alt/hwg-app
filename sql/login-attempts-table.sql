-- Auditoría de los 20 endpoints: api/login.js no tenía ningún freno — se
-- podían probar contraseñas para un email sin límite. Primera versión de
-- este archivo hacía el conteo con un SELECT desde login.js y un INSERT
-- aparte al fallar; Greptile encontró 3 problemas reales en ese diseño,
-- que esta versión resuelve con una función de Postgres en vez de hacerlo
-- desde el código del endpoint:
--
-- 1. Lockout dirigido: el límite era por email solo — cualquiera podía
--    tirar 5 contraseñas mal a propósito para el mail de OTRA persona y
--    dejarla afuera 15 minutos, repetible. Ahora la clave es (email, ip):
--    un ataque desde una IP no bloquea a la dueña de la cuenta entrando
--    desde la suya.
-- 2. Carrera entre el conteo y el guardado: dos pedidos en simultáneo
--    podían leer "todavía no llegué a 5" los dos antes de que ninguno
--    hubiera guardado el suyo, y los dos pasaban. record_login_attempt()
--    inserta y cuenta en una sola sentencia — no hay ventana entre leer y
--    guardar porque es la misma operación atómica.
-- 3. Un INSERT fallido (error de Supabase) no se enteraba nadie: quedaba
--    silencioso, y ese intento no contaba para el límite. Con la función,
--    login.js sí revisa la respuesta y ahora corta el login (falla
--    cerrado) si la función no pudo correr — más simple y más seguro que
--    seguir dejando pasar contraseñas sin ningún freno cuando algo falla.
--
-- RLS habilitado sin ninguna política en la tabla — mismo patrón que las
-- tablas de Finanzas: solo la service key (que usa login.js, vía RPC)
-- tiene acceso; la clave anónima queda afuera. Las funciones son
-- SECURITY DEFINER para poder escribir en la tabla bloqueada.

create table if not exists login_attempts (
  id bigserial primary key,
  email text not null,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists login_attempts_email_ip_created_idx
  on login_attempts (email, ip, created_at);

alter table login_attempts enable row level security;

-- Reserva un intento (INSERT) y devuelve, en la misma sentencia, cuántos
-- hay para ese (email, ip) en los últimos p_window_minutes — incluido el
-- que acaba de insertar. De paso, borra intentos viejos (más de un día,
-- de cualquier email/ip) para que la tabla no crezca sin límite (Greptile
-- — no hay ningún cron en este proyecto para una limpieza aparte, así que
-- va montada acá, barata dado el volumen esperado de esta tabla).
create or replace function record_login_attempt(p_email text, p_ip text, p_window_minutes int default 15)
returns table(attempt_id bigint, recent_count int)
language plpgsql
security definer
as $$
declare
  v_id bigint;
  v_count int;
begin
  delete from login_attempts where created_at < now() - interval '1 day';

  insert into login_attempts (email, ip) values (p_email, p_ip) returning id into v_id;

  select count(*) into v_count from login_attempts
    where email = p_email and ip = p_ip
      and created_at >= now() - make_interval(mins => p_window_minutes);

  return query select v_id, v_count;
end;
$$;

-- Login exitoso: se borran los intentos previos de ese (email, ip) — una
-- contraseña correcta no debe dejar arrastrando un contador que ya no
-- significa nada.
create or replace function clear_login_attempts(p_email text, p_ip text)
returns void
language sql
security definer
as $$
  delete from login_attempts where email = p_email and ip = p_ip;
$$;

revoke all on function record_login_attempt(text, text, int) from anon, authenticated;
revoke all on function clear_login_attempts(text, text) from anon, authenticated;
