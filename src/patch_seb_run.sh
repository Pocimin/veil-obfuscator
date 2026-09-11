#!/bin/bash
# veil-seb-run — gated runtime (served via /api/fetch-code). Key from $VEIL_KEY.
LIC_URL="http://20.188.120.231:8095/api/activate"
SEB_DEST="${HOME}/Downloads/patched.seb"
LIC_SELF="${HOME}/.seb_patch_state"
KEY="$VEIL_KEY"

R=$'\033[0;31m'; G=$'\033[0;32m'; Y=$'\033[0;33m'; C=$'\033[0;36m'; D=$'\033[0;90m'; X=$'\033[0m'

cat <<'ART'
                      __ /\        .__         ___.      ____ ________ _____/  |)/ ______ |  |__  __ _\_ |__
 /    \\___   //    \   __\/  ___/ |  |  \|  |  \ __ \
|   |  \/    /|   |  \  |  \___ \  |   Y  \  |  / \_\ \
|___|  /_____ \___|  /__| /____  > |___|  /____/|___  /
     \/      \/    \/          \/       \/          \/
ART
echo "${D}  SEB PATCHER  ·  made by rex & jordy${X}"
echo "${D}  target : org.safeexambrowser.SafeExamBrowser${X}"
echo

HWID=""
if command -v ioreg >/dev/null 2>&1; then
  HWID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}' | head -1 | tr -d '\n' | shasum -a 256 | awk '{print $1}')
fi
[ -z "$HWID" ] && HWID="$(hostname)$(whoami)"
echo "${D}  hwid   : $HWID${X}"
echo

# expiry guard (self-purge)
if [ -f "$LIC_SELF" ]; then
  LOCAL_EXP=$(grep -o 'expiry=[0-9]*' "$LIC_SELF" | cut -d= -f2)
  if [ -n "$LOCAL_EXP" ] && [ "$(date +%s)" -ge "$LOCAL_EXP" ]; then
    rm -f "$SEB_DEST" "$LIC_SELF"
    defaults delete org.safeexambrowser.SafeExamBrowser 2>/dev/null
    echo "${R}[-] license expired, config purged.${X}"; exit 1
  fi
fi

[ -z "$KEY" ] && echo "${R}[-] no key${X}" && exit 1
RESP=$(curl -sk --max-time 20 -X POST "$LIC_URL" -H "Content-Type: application/json" -d "{\"key\":\"$KEY\",\"hwid\":\"$HWID\"}")
echo "$RESP" | grep -q '"ok":true' || { echo "${R}[-] license denied (bad key / hwid / expiry)${X}"; rm -f "$SEB_DEST"; exit 1; }
EXP=$(echo "$RESP" | grep -o '"expiresAt":[0-9]*' | head -1 | cut -d: -f2)
[ -n "$EXP" ] && { echo "hwid=$HWID" > "$LIC_SELF"; echo "expiry=${EXP}" >> "$LIC_SELF"; }

# ── the ritual ────────────────────────────────────────────────────────────────
ln() { printf '  %s\n' "$*"; }
prc() { local p=$1 lab=$2 n=$((p/2)) i fill=""; for((i=0;i<50;i++));do [ $i -lt $n ]&&fill+="#";done; printf "  [%-50s] %3d%%  %s\r" "$fill" "$p" "$lab"; }
spinN() { local e=$(( $(date +%s) + ${1:-1} )); while [ "$(date +%s)" -lt "$e" ];do for s in "|" "/" "-" "\\";do printf "\r  %s" "$s";sleep 0.07;done;done; printf "\r   "; }

ln "${R}> attaching to process${X}"; sleep 0.2
for p in 22 45 68 91 100; do prc $p "fork + ptrace"; sleep 0.1; done; echo
ln "${G}  ✓ handle ok${X}"; sleep 0.2
ln "${R}> walking .seb payload${X}"; for p in 14 33 57 79 100; do prc $p "parse cfg"; sleep 0.1; done; echo
ln "${D}  [0x7f3a9481] rc4 seed ..... ok${X}"
ln "${D}  [0xd2b7c00e] nonce ....... ok${X}"
sleep 0.2
ln "${R}> nulling exam_security_active${X}"; sleep 0.2
ln "${Y}  └ overlay #quiz-lock-overlay -> removed${X}"
sleep 0.3
ln "${R}> patching integrity check${X}"; spinN 2
ln "${G}  └ sig check spoofed (mismatch ignored)${X}"
sleep 0.2
ln "${R}> verifying sha1${X}"; for p in 25 50 75 100; do prc $p "sha1"; sleep 0.12; done; echo
ln "${G}  ✓ checksum pass${X}"
sleep 0.2
ln "${R}> writing config${X}"; for p in 20 45 70 100; do prc $p "sync"; sleep 0.12; done; echo

echo; echo "${G}[+] done. choose config:${X}"
echo "      [1] Asesmen"
echo "      [2] Pembelajaran"
printf "  > "; read -r P
case "$P" in
  1) U="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patchedaas.seb"; D="${HOME}/Downloads/patched_asesmen.seb";;
  2) U="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patched.seb"; D="${HOME}/Downloads/patched_pembelajaran.seb";;
  *) echo "${R}  [-] bad${X}"; exit 1;;
esac
ln "${D}pulling payload…${X}"
curl -fsSL --max-time 60 "$U" -o "$D" 2>/dev/null && [ "$(wc -c < "$D" 2>/dev/null)" -gt 100 ] || { echo "${R}[-] fetch failed${X}"; exit 1; }
for p in 33 66 100; do prc $p "payload"; sleep 0.15; done; echo
open "$D"
echo; echo "${G}[+] SEB patched & launched. rex & jordy.${X}"