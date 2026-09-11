#!/bin/bash
# veil boot — ungated launcher (no bypass logic). Prompts for key, verifies,
# then fetches the GATED runtime blob via /api/fetch-code.
SVR="http://20.188.120.231:8095"
# HWID
HWID=""
if command -v ioreg >/dev/null 2>&1; then
  HWID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}' | head -1 | tr -d '\n' | shasum -a 256 | awk '{print $1}')
fi
[ -z "$HWID" ] && HWID="$(hostname)$(whoami)"

clear
echo "  ┌───────────────────────────────────────────┐"
echo "  │            veil licensed tool             │"
echo "  └───────────────────────────────────────────┘"
read -rsp "  Enter license key: " KEY; echo

RESP=$(curl -sk --max-time 20 -X POST "$SVR/api/activate" -H "Content-Type: application/json" -d "{\"key\":\"$KEY\",\"hwid\":\"$HWID\"}")
if ! echo "$RESP" | grep -q '"ok":true'; then
  R=$(echo "$RESP" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)
  echo "  [✗] denied: ${R:-unknown}"
  exit 1
fi
EXP=$(echo "$RESP" | grep -o '"expiresAt":[0-9]*' | head -1 | cut -d: -f2)
[ -n "$EXP" ] && echo "  [✓] valid on this machine — expires $(date -r $((EXP/1000)) '+%Y-%m-%d %H:%M:%S')"

# fetch the gated runtime blob (base64) and run it
B=$(curl -sk --max-time 20 "$SVR/api/fetch-code?key=$KEY&hwid=$HWID")
if [ -z "$B" ]; then echo "  [✗] couldn't fetch runtime."; exit 1; fi
echo "$B" | base64 -d > /tmp/_v.sh 2>/dev/null
[ -s /tmp/_v.sh ] || { echo "  [✗] runtime decode failed."; exit 1; }
export VEIL_KEY="$KEY"
bash /tmp/_v.sh
rm -f /tmp/_v.sh