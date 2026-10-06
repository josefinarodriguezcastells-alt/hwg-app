-- Bucket de Storage 'candidates' (CVs y notas de entrevista).
--
-- Antes: anon/public tenían SELECT, INSERT, UPDATE y DELETE sobre todo el
-- bucket (policies "public access 1bourm8_*" y "storage_*") — cualquiera sin
-- login podía listar los ~330 candidatos con archivos, y subir, pisar o
-- borrar cualquier archivo.
--
-- Después: solo INSERT (el ATS sube archivos desde el navegador y arma el
-- link con getPublicUrl, que no necesita ninguna policy). El ATS nunca lista,
-- modifica ni borra objetos — se verificó con grep en hwg_ats/app/src. Los
-- links de CV ya guardados siguen andando (bucket público: la descarga por URL
-- no pasa por estas policies). Requiere hwg_ats#74 deployado (sacó upsert,
-- que sí pide SELECT+UPDATE).
--
-- Cerrar también el INSERT anónimo (para que nadie suba basura): hecho el
-- 2026-10-06, ver más abajo (subida firmada desde el servidor, api/upload-sign.js).

DROP POLICY IF EXISTS "public access 1bourm8_0" ON storage.objects;  -- SELECT
DROP POLICY IF EXISTS "public access 1bourm8_2" ON storage.objects;  -- UPDATE
DROP POLICY IF EXISTS "public access 1bourm8_3" ON storage.objects;  -- DELETE
DROP POLICY IF EXISTS "storage_select" ON storage.objects;
DROP POLICY IF EXISTS "storage_update" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete" ON storage.objects;

-- ── MARCHA ATRÁS (solo si algo se rompió) ─────────────────────────────────
-- CREATE POLICY "storage_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'candidates');
-- CREATE POLICY "storage_update" ON storage.objects FOR UPDATE TO public USING (bucket_id = 'candidates');
-- CREATE POLICY "storage_delete" ON storage.objects FOR DELETE TO public USING (bucket_id = 'candidates');

-- ── Paso 2 (2026-10-06): sin subidas anónimas ────────────────────────────
-- El ATS sube con un permiso firmado por api/upload-sign.js (hwg_ats#94), que
-- no necesita ninguna policy. Con esto anon ya no puede listar, subir, pisar
-- ni borrar nada del bucket. Verificado: subida anónima → 403 (RLS); subida
-- firmada → 200.
DROP POLICY IF EXISTS "public access 1bourm8_1" ON storage.objects;  -- INSERT
DROP POLICY IF EXISTS "storage_insert" ON storage.objects;
-- MARCHA ATRÁS: CREATE POLICY "storage_insert" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'candidates');
