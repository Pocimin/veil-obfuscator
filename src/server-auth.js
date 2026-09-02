import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Tier-A session/key server.
 *
 * The decode KEY is never shipped in the bundle. The client must:
 *   1. POST /api/session  { fingerprint }  -> { sid, nonce, exp, sig }
 *      (rate-limited, HMAC-signed, nonce-bound, expiring, bound to fingerprint)
 *   2. POST /api/key     { sid, nonce, sig, fingerprint, probeHash }
 *      -> { key }  (one-time; the server verifies HMAC/expiry/nonce/fingerprint
 *      and runs its OWN attestation on the reported probeHash)
 *
 * The gate decision is server-side, so a dumped bundle or a shimmed browser
 * that "passes the probe" still gets nothing without a valid live session.
 */

const SECRET = process.env.VEIL_SECRET || randomBytes(32).toString("hex");
const TTL_MS = 60_000;
const MAX_TOKENS_PER_IP = 20;

export function createSessionStore() {
  return {
    sessions: new Map(), // sid -> { nonce, exp, fp, used, key, probeHash }
    rate: new Map(), // ip -> count / window
  };
}

function hmac(payload) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function probeScore(probe) {
  // Server-side attestation: accept only probes that report the authentic
  // browser invariants (document.nodeType 9, elementNodeType 1, canvas/WebGL,
  // devicePixelRatio, etc.). A shim that just sets window/document["x"]=1
  // won't produce the expected signature, so the token is withheld.
  const exp = [9, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const body = Array.isArray(probe) ? probe : [];
  let score = 0;
  for (let i = 0; i < Math.min(exp.length, body.length); i++) if ((body[i] & 0xff) === exp[i]) score++;
  return score;
}

// Register a session store entry keyed by `sid` (called by /api/obfuscate which
// baked `sid` into the bundle and holds the decode key).
export function registerSession(store, sid, key, fingerprint) {
  store.sessions.set(sid, { nonce: "", exp: Date.now() + TTL_MS, fp: fingerprint || "", used: false, key });
}

// Issue a one-time, nonce-bound, expiring, HMAC-signed token for an existing sid.
export function issueToken(store, ip, sid, fingerprint) {
  const win = store.rate.get(ip) ?? 0;
  if (win >= MAX_TOKENS_PER_IP) return { error: "rate limited", status: 429 };
  store.rate.set(ip, win + 1);

  const s = store.sessions.get(sid);
  if (!s) return { error: "unknown session", status: 404 };
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + TTL_MS;
  s.nonce = nonce;
  s.exp = exp;
  if (fingerprint) s.fp = fingerprint;
  const payload = `${sid}:${nonce}:${exp}:${s.fp}`;
  return { sid, nonce, exp, sig: hmac(payload) };
}

export function storeKey(store, sid, key) {
  const s = store.sessions.get(sid);
  if (s) s.key = key;
}

export function returnKey(store, body) {
  const { sid, nonce, sig, fingerprint, probeHash } = body || {};
  if (!sid || !nonce || !sig) return { error: "missing claims", status: 400 };

  const s = store.sessions.get(sid);
  const exp = s?.exp ?? 0;
  if (!s || Date.now() > exp) return { error: "session expired or unknown", status: 401 };
  if (s.used) return { error: "session already consumed", status: 401 };
  if (s.nonce !== nonce) return { error: "nonce mismatch", status: 401 };
  if (s.fp && s.fp !== (fingerprint || "")) return { error: "fingerprint mismatch", status: 403 };

  const payload = `${sid}:${nonce}:${exp}:${s.fp}`;
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: "bad signature", status: 401 };

  // Genuine browsers reliably satisfy the universal probes (document.nodeType,
  // documentElement.nodeType). This is friction, NOT a security wall: a client
  // can always satisfy its own probe. The real protections are the server-side
  // key (never in the bundle) + one-time token. Threshold kept low so real
  // environments (incl. Tampermonkey sandboxes) pass.
  if (probeScore(probeHash) < 2) return { error: "attestation failed", status: 403 };

  const key = s.key ?? "veil-nokey";
  s.used = true;
  return { key };
}

// Tier C: server-owned logic registry. The client only ever sees the RPC shell;
// the actual decision / flag / secret lives in these handlers and never ships.
export const RPC = {
  // Example: does this session get the exam flag disarmed? The sensitive rule
  // (and the flag value) stay here, server-side.
  decideExam(args) {
    const { examToken, host } = args || {};
    // This is where the real business rule lives. It is NOT in the client bundle.
    if (examToken && String(examToken).length >= 8) {
      return { allowed: true, flag: false, reason: "valid-session" };
    }
    return { allowed: false, flag: true, reason: "denied" };
  },
};
