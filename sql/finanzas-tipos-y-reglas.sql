-- Finanzas: tipos de datos correctos y reglas que hace cumplir la base.
--
-- Auditoría (6/10/2026): la base ya tenía fechas como date y montos como
-- numeric; lo que seguía en texto era billing.salario_bruto (guarda "ARS
-- 1205000", con la moneda pegada) y facturas.mes. Los montos "x1000" venían
-- del código (número -> texto -> número), no de la base. Esta migración:
--
-- 1) Respalda billing y facturas.
-- 2) billing.salario_monto (numeric): el sueldo como número. salario_bruto
--    (texto) se mantiene por compatibilidad; un trigger mantiene ambos en
--    sincronía para CUALQUIER escritor (la app, SQL, un import).
-- 3) facturas.mes pasa de text a date.
-- 4) Reglas (CHECK): la base rechaza estados/monedas/tipos inválidos, montos
--    negativos, garantía fuera de 0-365 y —regla de Jo— un fee de recruiter
--    mayor al fee del cliente.
--
-- Verificado antes: 0 violaciones en los datos actuales.
--
-- Rollback:
--   alter table facturas alter column mes type text using mes::text;
--   alter table billing drop constraint billing_estado_chk, drop constraint billing_moneda_chk,
--     drop constraint billing_tipo_chk, drop constraint billing_montos_chk,
--     drop constraint billing_recruiter_chk, drop constraint billing_garantia_chk;
--   alter table facturas drop constraint facturas_estado_chk, drop constraint facturas_moneda_chk;
--   drop trigger billing_sync_salario on billing; drop function billing_parse_monto(text);
--   drop function billing_sync_salario(); alter table billing drop column salario_monto;

create table zz_backup_billing_tipos_20261006 as select * from billing;
create table zz_backup_facturas_tipos_20261006 as select * from facturas;
alter table zz_backup_billing_tipos_20261006 enable row level security;
alter table zz_backup_facturas_tipos_20261006 enable row level security;
revoke all on zz_backup_billing_tipos_20261006, zz_backup_facturas_tipos_20261006 from anon, authenticated;

alter table billing add column if not exists salario_monto numeric;

-- "ARS $10.500.000" -> 10500000 ; "1.500,50" -> 1500.5 ; "USD 5500" -> 5500
create or replace function billing_parse_monto(t text) returns numeric language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then null
    when regexp_replace(t, '[^0-9.,]', '', 'g') = '' then null
    when regexp_replace(t, '[^0-9.,]', '', 'g') like '%,%' then replace(replace(regexp_replace(t, '[^0-9.,]', '', 'g'), '.', ''), ',', '.')::numeric
    when regexp_replace(t, '[^0-9.,]', '', 'g') ~ '^[0-9]{1,3}(\.[0-9]{3})+$' then replace(regexp_replace(t, '[^0-9.,]', '', 'g'), '.', '')::numeric
    else regexp_replace(t, '[^0-9.,]', '', 'g')::numeric
  end
$$;

create or replace function billing_sync_salario() returns trigger language plpgsql as $$
begin
  new.salario_monto := billing_parse_monto(new.salario_bruto);
  return new;
end $$;
drop trigger if exists billing_sync_salario on billing;
create trigger billing_sync_salario before insert or update of salario_bruto on billing for each row execute function billing_sync_salario();

update billing set salario_bruto = salario_bruto where coalesce(salario_bruto, '') <> '';

alter table facturas alter column mes type date using mes::date;

alter table billing add constraint billing_estado_chk check (estado in ('por_facturar', 'facturado', 'cobrado', 'cancelado'));
alter table billing add constraint billing_moneda_chk check (moneda is null or moneda in ('USD', 'ARS'));
alter table billing add constraint billing_tipo_chk check (tipo_busqueda is null or tipo_busqueda in ('nueva', 'garantia', 'embedded', 'hiring_bonus'));
alter table billing add constraint billing_montos_chk check (coalesce(fee_cliente_monto, 0) >= 0 and coalesce(fee_recruiter_monto, 0) >= 0 and coalesce(salario_monto, 0) >= 0);
alter table billing add constraint billing_recruiter_chk check (fee_recruiter_monto is null or fee_cliente_monto is null or fee_recruiter_monto <= fee_cliente_monto);
alter table billing add constraint billing_garantia_chk check (garantia_dias is null or garantia_dias between 0 and 365);
alter table facturas add constraint facturas_estado_chk check (estado in ('por_facturar', 'facturado', 'cobrado', 'cancelado'));
alter table facturas add constraint facturas_moneda_chk check (moneda in ('USD', 'ARS'));
