-- Bloquea el acceso directo (anon key) a las tablas de Finanzas/Entidades.
-- Con RLS habilitado y SIN política para 'anon', Postgres deniega todo por
-- default — el service role (usado en api/owner-data.js) sigue teniendo
-- acceso total porque bypassea RLS siempre.
--
-- ⚠️ NO correr esto todavía. Recién después de que:
--   1. api/owner-data.js y api/login.js estén deployados en hwg-app, con
--      SESSION_SECRET y SUPABASE_SERVICE_KEY configuradas en Vercel.
--   2. El index.html del ATS con secureTable() esté deployado (rama
--      fix/login-security mergeada a main y build activo).
-- Si corrés esto antes, Finanzas/Admin/Entidades/Datos bancarios se rompen
-- para todo el mundo hasta que el frontend nuevo esté en producción.
--
-- La tabla `users` queda afuera a propósito: la usan varias pantallas no
-- exclusivas de owner (asignar recruiter, portal de cliente, etc.) que no
-- pasan por api/owner-data.js, así que bloquear el acceso anónimo ahí
-- rompería esas pantallas. Users solo se resguardó a nivel aplicación
-- (password nunca sale del server) — ver conversación para más contexto.

ALTER TABLE billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedded_nomina_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedded_nomina ENABLE ROW LEVEL SECURITY;
ALTER TABLE entidades_facturadoras ENABLE ROW LEVEL SECURITY;

-- Sin ninguna política CREATE POLICY para 'anon', el acceso queda denegado
-- por default con RLS habilitado. No hace falta agregar nada más.
