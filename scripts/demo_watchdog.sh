#!/usr/bin/env bash
# Ping studio live demos; optionally restart Amvera slugs that return non-200.
set -euo pipefail

TARGETS=(
  "benzobiznes|https://benzobiznes-koujikin.amvera.io/"
  "wechat|https://wechat-koujikin.amvera.io/"
  "bot-whatsapp|https://bot-whatsapp-koujikin.amvera.io/"
  "mebel-erp|https://mebel-erp-koujikin.amvera.io/"
  "nizom|https://nizom-koujikin.amvera.io/"
  "akmal|https://akmal-koujikin.amvera.io/"
  "otdel-kadrov|https://otdel-kadrov-koujikin.amvera.io/"
)

REGION="${AMVERA_REGION:-msk_0}"
RESTART="${WATCHDOG_RESTART:-1}"
FAILS=0

echo "[demo-watchdog] $(date -u +%Y-%m-%dT%H:%M:%SZ) region=$REGION restart=$RESTART"

for entry in "${TARGETS[@]}"; do
  slug="${entry%%|*}"
  url="${entry#*|}"
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$url" || echo "000")
  if [[ "$code" =~ ^(200|301|302|303|307|308|401|403)$ ]]; then
    echo "OK  $slug -> $code $url"
    continue
  fi

  echo "BAD $slug -> $code $url"
  FAILS=$((FAILS + 1))

  if [[ "$RESTART" == "1" ]] && command -v amvera >/dev/null 2>&1; then
    echo "  -> scale+start $slug"
    amvera scale -s "$slug" --replicas 1 --region "$REGION" || true
    amvera start -s "$slug" || true
    sleep 12
    code2=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$url" || echo "000")
    echo "  -> after start $code2"
    if [[ "$code2" =~ ^(200|301|302|303|307|308|401|403)$ ]]; then
      FAILS=$((FAILS - 1))
    fi
  fi
done

if [[ "$FAILS" -gt 0 ]]; then
  echo "[demo-watchdog] FAILED hosts=$FAILS"
  exit 1
fi

echo "[demo-watchdog] all healthy"
