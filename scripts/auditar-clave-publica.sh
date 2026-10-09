#!/usr/bin/env bash
# Prueba desde afuera (como lo haría cualquiera con la clave publicable del sitio):
# lee, escribe y llama funciones. Sale con error si algo responde que SÍ se pudo.
# Ojo: `select=*` solo no alcanza; se prueba también con columnas sueltas.
# Uso:  scripts/auditar-clave-publica.sh [clave-publicable]   (por defecto la del ATS)
set -u
URL="https://sdoxrlxfwldhnqvuioty.supabase.co"
KEY="${1:-sb_publishable_5zlYLDfu2p7TRQKcCykuKA_2NxCRE5G}"
Z="00000000-0000-0000-0000-000000000000"
fallas=0
mal() { echo "FALLA  $1"; fallas=$((fallas+1)); }
for t in users users_public candidates applications positions clients billing facturas scorecards scorecard_templates candidate_presentations candidate_documents login_attempts notifications outreach_logs prefilter_questions prefilter_responses finanzas_log app_settings client_secrets; do
  for cols in '*' 'id' 'id,email,name,role'; do
    code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$URL/rest/v1/$t?select=$cols&limit=1" -H "apikey: $KEY")
    [ "$code" = "200" ] && mal "se puede LEER $t ($cols)"
  done
  for m in PATCH DELETE; do
    code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X $m "$URL/rest/v1/$t?id=eq.$Z" -H "apikey: $KEY" -H 'Content-Type: application/json' -H 'Prefer: return=minimal' -d '{"id":"'$Z'"}')
    case "$code" in 200|204) mal "hay permiso de ESCRIBIR ($m) sobre $t (responde $code)";; esac
  done
done
for fn in record_login_attempt clear_login_attempts billing_desde_hire billing_completar_referencias; do
  code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/rpc/$fn" -H "apikey: $KEY" -H 'Content-Type: application/json' -d '{"p_email":"auditoria@invalid.example","p_ip":"203.0.113.9"}')
  case "$code" in 200|204) mal "se puede EJECUTAR la función $fn (responde $code)";; esac
done
if [ "$fallas" = "0" ]; then echo "OK: con la clave pública no se lee, no se escribe y no se ejecuta nada."; else echo "$fallas problema(s)."; exit 1; fi
