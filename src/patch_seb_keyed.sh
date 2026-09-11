#!/bin/bash
# SEB Patcher (keyed) - patches Safe Exam Browser config
# License: key verified against your VPS, bound to ONE HWID, time-limited.
# Usage: bash <(curl -fsSL https://your-vps/patch_seb_keyed.sh)

# ── CONFIG ───────────────────────────────────────────────────────────────────
LIC_URL="http://20.188.120.231:8095/api/activate"   # your VPS license server
LIC_SELF="${HOME}/.seb_patch_state"              # local state (hwid+expiry)
SEB_DEST="${HOME}/Downloads/patched.seb"

clear
echo "  ┌─────────────────────────────────────────┐"
echo "  │         SEB Configuration Patcher       │"
echo "  │              (licensed edition)         │"
echo "  └─────────────────────────────────────────┘"
echo ""

# ── 0. compute stable HWID (macOS system UUID, hashed) ───────────────────────
HWID=""
if command -v ioreg >/dev/null 2>&1; then
  HWID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null \
         | awk -F'"' '/IOPlatformUUID/{print $4}' | head -1 | tr -d '\n' \
         | shasum -a 256 | awk '{print $1}')
fi
if [ -z "$HWID" ]; then HWID="$(hostname)$(whoami)"; fi

echo "  [▸] This machine HWID: ${HWID:0:16}…"
sleep 0.3

# ── 1. local expiry guard (self-delete if time is up) ─────────────────────────
if [ -f "$LIC_SELF" ]; then
  LOCAL_EXP=$(grep -o 'expiry=[0-9]*' "$LIC_SELF" | cut -d= -f2)
  if [ -n "$LOCAL_EXP" ] && [ "$(date +%s)" -ge "$LOCAL_EXP" ]; then
    echo "  [✗] License time is over. Removing patched config."
    rm -f "$SEB_DEST" "$LIC_SELF"
    defaults delete org.safeexambrowser.SafeExamBrowser 2>/dev/null
    exit 1
  fi
fi

# ── 2. request license key ──────────────────────────────────────────────────
echo -n "  Enter license key: "
read -s KEY
echo ""

# ── 3. verify key + HWID against the VPS ──────────────────────────────────────
RESP=$(curl -sk --max-time 20 -X POST "$LIC_URL" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$KEY\",\"hwid\":\"$HWID\"}" 2>/dev/null)

OK=$(echo "$RESP" | grep -o '"ok":true')
if [ -z "$OK" ]; then
  REASON=$(echo "$RESP" | grep -o '"reason":"[^"]*"' | cut -d'"' -f4)
  echo "  [✗] License rejected: ${REASON:-unknown}"
  rm -f "$SEB_DEST"
  exit 1
fi
EXP=$(echo "$RESP" | grep -o '"expiresAt":[0-9]*' | head -1 | cut -d: -f2)
echo "  [✓] License valid (HWID-bound)."
[ -n "$EXP" ] && echo "  [✓] Expires: $(date -r $((EXP/1000)) '+%Y-%m-%d %H:%M:%S')"

# ── 4. store local expiry marker ─────────────────────────────────────────────
if [ -n "$EXP" ]; then
  echo "hwid=$HWID" > "$LIC_SELF"
  echo "expiry=${EXP}" >> "$LIC_SELF"
fi

sleep 0.3

# ── 5. select patch type ─────────────────────────────────────────────────────
echo ""
echo "  Select patch type:"
echo "  [1] Asesmen"
echo "  [2] Pembelajaran"
echo -n "  Enter choice (1 or 2): "
read PATCH_CHOICE
echo ""
case "$PATCH_CHOICE" in
  1) SEB_URL="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patchedaas.seb"
     FALLBACK="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patchedaas.seb"
     DEST="${HOME}/Downloads/patched_asesmen.seb" ;;
  2) SEB_URL="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/patched.seb"
     FALLBACK="https://raw.githubusercontent.com/Pocimin/wayground-cheat/main/config.seb"
     DEST="${HOME}/Downloads/patched_pembelajaran.seb" ;;
  *) echo "  [✗] Invalid choice."; exit 1 ;;
esac

# ── 6. download + apply ──────────────────────────────────────────────────────
echo "  [▸] Downloading patch…"
DONE=0
for u in "$SEB_URL" "$FALLBACK"; do
  if curl -fsSL --max-time 60 "$u" -o "$DEST" 2>/dev/null && [ "$(wc -c < "$DEST" 2>/dev/null)" -gt 100 ]; then
    echo "  [✓] Patch downloaded."
    DONE=1; break
  fi
done
if [ "$DONE" -ne 1 ]; then echo "  [✗] Download failed."; exit 1; fi

echo "  [▸] Opening Safe Exam Browser…"
open "$DEST"
echo "  [✓] Applied."

echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │   ✓  SEB licensed & configured.         │"
echo "  │      Key is tied to this machine.       │"
echo "  │      Re-run after expiry = self-delete. │"
echo "  └─────────────────────────────────────────┘"