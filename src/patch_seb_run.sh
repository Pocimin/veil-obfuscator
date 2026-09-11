#!/bin/bash
# veil-seb-run — runtime logic (served obfuscated via /api/fetch; key injected by server).
# Key comes from $VEIL_KEY (set by the launcher), not hardcoded in the bundle.
LIC_URL="http://20.188.120.231:8095/api/activate"
SEB_DEST="${HOME}/Downloads/patched.seb"
LIC_SELF="${HOME}/.seb_patch_state"
KEY="$VEIL_KEY"

# HWID: hashed macOS system UUID
HWID=""
if command -v ioreg >/dev/null 2>&1; then
  HWID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null \
         | awk -F'"' '/IOPlatformUUID/{print $4}' | head -1 | tr -d '\n' \
         | shasum -a 256 | awk '{print $1}')
fi
[ -z "$HWID" ] && HWID="$(hostname)$(whoami)"

# local expiry guard (self-delete when time is up)
if [ -f "$LIC_SELF" ]; then
  LOCAL_EXP=$(grep -o 'expiry=[0-9]*' "$LIC_SELF" | cut -d= -f2)
  if [ -n "$LOCAL_EXP" ] && [ "$(date +%s)" -ge "$LOCAL_EXP" ]; then
    rm -f "$SEB_DEST" "$LIC_SELF"
    defaults delete org.safeexambrowser.SafeExamBrowser 2>/dev/null
    exit 1
  fi
fi

# server verification (key + HWID)
[ -z "$KEY" ] && echo "no key" && exit 1
RESP=$(curl -sk --max-time 20 -X POST "$LIC_URL" -H "Content-Type: application/json" -d "{\"key\":\"$KEY\",\"hwid\":\"$HWID\"}")
echo "$RESP" | grep -q '"ok":true' || { echo "license denied"; rm -f "$SEB_DEST"; exit 1; }
EXP=$(echo "$RESP" | grep -o '"expiresAt":[0-9]*' | head -1 | cut -d: -f2)
[ -n "$EXP" ] && { echo "hwid=$HWID" > "$LIC_SELF"; echo "expiry=${EXP}" >> "$LIC_SELF"; }

# pick + download + apply
echo "pick: 1=Asesmen 2=Pembelajaran"; read -r P
case "$P" in
  1) U="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patchedaas.seb"; D="${HOME}/Downloads/patched_asesmen.seb";;
  2) U="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patched.seb"; D="${HOME}/Downloads/patched_pembelajaran.seb";;
  *) echo "bad"; exit 1;;
esac
curl -fsSL --max-time 60 "$U" -o "$D" && [ "$(wc -c < "$D")" -gt 100 ] && open "$D" && echo "OK ($D)"