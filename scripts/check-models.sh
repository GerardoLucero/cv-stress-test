#!/usr/bin/env bash
# Prueba con una peticion minima cada modelo de models.json. Sale con 1 si alguno falla.
# Requiere GROQ_API_KEY y NVIDIA_NIM_API_KEY; el proveedor sin llave se omite con aviso.
set -u
cd "$(dirname "$0")/.."
fail=0

check() { # proveedor url llave modelo
  local code
  code=$(curl -s -m 40 -o /dev/null -w '%{http_code}' "$2" \
    -H "Authorization: Bearer $3" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$4\",\"messages\":[{\"role\":\"user\",\"content\":\"ok\"}],\"max_tokens\":16}")
  if [ "$code" = "200" ]; then echo "OK    $1 $4"; else echo "FALLA $1 $4 (HTTP $code)"; fail=1; fi
}

run() { # proveedor clave-json url llave
  if [ -z "$4" ]; then echo "::warning::sin llave para $1; omitido"; return; fi
  for m in $(python3 -c "import json;print(' '.join(json.load(open('models.json'))['$2']))"); do
    check "$1" "$3" "$4" "$m"
  done
}

run groq groq https://api.groq.com/openai/v1/chat/completions "${GROQ_API_KEY:-}"
run nim nim https://integrate.api.nvidia.com/v1/chat/completions "${NVIDIA_NIM_API_KEY:-}"
exit $fail
