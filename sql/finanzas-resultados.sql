-- Finanzas: libro de resultados (la hoja "Detalle" de Silvana).
--
-- Una fila por hire o por factura mensual de embedded, con lo que el ATS no
-- guarda para el historial: costo de recruiters, neto de HWG y el reparto
-- Jose / Sil. De acá salen las vistas de "Socias" (resumen anual, mensual,
-- por cliente, por recruiter, Embedded vs Éxito).
-- La carga la hace Silvana desde Finanzas > Socias > Importar. fila_origen es
-- el número de fila de su hoja "Ingresos-hires" y es único: al importar de
-- nuevo, las filas con el mismo número se reemplazan.
--
-- Mismo patrón que billing: RLS sin políticas, sin permisos para anon ni
-- authenticated, grant solo a service_role (a las tablas nuevas el servidor
-- no las ve si falta ese grant).

create table if not exists finanzas_resultados (
  id               uuid primary key default gen_random_uuid(),
  fila_origen      integer not null unique,
  anio             integer not null check (anio between 2020 and 2100),
  mes              integer check (mes between 1 and 12),
  cliente          text not null,
  candidato        text,
  posicion         text,
  recruiter        text,
  fecha_ingreso    text,
  moneda           text not null check (moneda in ('ARS','USD')),
  sueldo           numeric,
  facturado        numeric,
  neto             numeric,
  costo_recruiters numeric,
  ganancia_jose    numeric,
  ganancia_sil     numeric,
  incluir          boolean not null default true,
  modelo           text not null default 'exito' check (modelo in ('exito','embedded')),
  nota             text,
  billing_id       uuid,
  created_at       timestamptz not null default now()
);
create index if not exists finanzas_resultados_periodo_idx on finanzas_resultados (anio, mes);

alter table finanzas_resultados enable row level security;
revoke all on finanzas_resultados from anon, authenticated;
grant all on finanzas_resultados to service_role;
