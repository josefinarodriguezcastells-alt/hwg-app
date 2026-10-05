// Simula, para los tests de los endpoints del portal, lo que desde la Fase 1b
// vive aparte de `clients`: la tabla client_secrets (el PIN) y las dos
// funciones del freno de intentos (record_login_attempt / clear_login_attempts).
// El PIN sigue declarándose en el array CLIENTS de cada test (portal_pin) y de
// ahí sale client_secrets, así los casos de los tests no cambian.
//
// Uso, al principio del mock de fetch de Supabase:
//   const pm = portalPinMock(url, opts, CLIENTS); if (pm) return pm;

const intentos = new Map();
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });

export function portalPinMock(url, opts, clients) {
  const u = new URL(String(url));
  const path = u.pathname.replace('/rest/v1/', '');
  if (path === 'rpc/record_login_attempt') {
    const { p_email, p_ip } = JSON.parse(opts.body);
    const k = `${p_email}|${p_ip}`;
    intentos.set(k, (intentos.get(k) || 0) + 1);
    return json([{ attempt_id: 1, recent_count: intentos.get(k) }], 201);
  }
  if (path === 'rpc/clear_login_attempts') {
    const { p_email, p_ip } = JSON.parse(opts.body);
    intentos.delete(`${p_email}|${p_ip}`);
    return json([], 200);
  }
  if (path === 'client_secrets') {
    const id = (u.searchParams.get('client_id') || '').replace(/^eq\./, '');
    const pin = (u.searchParams.get('portal_pin') || '').replace(/^eq\./, '');
    return json(clients.filter((c) => c.id === id && c.portal_pin && c.portal_pin === pin).map((c) => ({ client_id: c.id })));
  }
  return null;
}
export const reiniciarIntentos = () => intentos.clear();
