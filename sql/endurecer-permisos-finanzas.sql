-- Capa extra de seguridad (2026-10-07): la clave pública ya no puede ni siquiera
-- "tocar" estas tablas. Hoy RLS ya no le deja ver ni cambiar filas, pero los
-- permisos de tabla seguían ahí (incluido TRUNCATE, que RLS no frena). El ATS y el
-- servidor usan la clave de servicio, que no se afecta.
--
-- MARCHA ATRÁS: grant all on <las mismas tablas> to anon, authenticated;

revoke all on public.billing, public.facturas, public.embedded_nomina, public.embedded_nomina_personas,
  public.entidades_facturadoras, public.candidate_presentations, public.outreach_sequences,
  public.outreach_sequence_steps, public.word_download_log from anon, authenticated;
