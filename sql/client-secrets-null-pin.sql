-- Fase 1b, paso 2 de 2: recién cuando el servidor (api/portal-verify.js,
-- _portal.js) y el frontend nuevos están en producción y verificados, se
-- borran los PIN de la tabla pública `clients`. Después de esto la clave
-- anónima ya no puede leer ningún PIN.
--
-- Guarda: si algún PIN de `clients` no quedó copiado en client_secrets,
-- aborta sin tocar nada (no se puede perder un PIN).

do $$
begin
  if exists (
    select 1 from clients c
    where c.portal_pin is not null and c.portal_pin <> ''
      and not exists (select 1 from client_secrets s where s.client_id = c.id and s.portal_pin = c.portal_pin)
  ) then
    raise exception 'Hay PIN en clients que no están en client_secrets: correr primero client-secrets-table.sql';
  end if;
end $$;

update clients set portal_pin = null where portal_pin is not null;

-- Rollback (restaura los PIN desde la tabla bloqueada):
--   update clients c set portal_pin = s.portal_pin from client_secrets s where s.client_id = c.id;
