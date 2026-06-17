// In-memory registry of call sessions, keyed by the caller's phone number. It
// lets the two Webex flows share information via the middleware and tracks
// whether each call has been activated (bridged) yet. Entries expire after a
// TTL so the map can't grow without bound. Pure/injectable for testing.

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Canonical phone key: digits only, with a US country code dropped, so
 *  "+16195764744", "6195764744" and "(619) 576-4744" all compare equal. */
export function normalizePhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** E.164 form, e.g. "+16195764744". Falls back to "+<digits>" for non-US lengths. */
export function toE164(phone) {
  const d = normalizePhone(phone);
  if (!d) return '';
  return d.length === 10 ? `+1${d}` : `+${d}`;
}

/** Human-friendly form, e.g. "(619) 576-4744". Falls back to E.164 for non-10-digit. */
export function toDisplay(phone) {
  const d = normalizePhone(phone);
  if (!d) return '';
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return toE164(phone);
}

export function createSessionRegistry({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  /** @type {Map<string, Record<string, any>>} */
  const byKey = new Map();

  function prune() {
    const cutoff = now() - ttlMs;
    for (const [key, entry] of byKey) {
      if (entry.updatedAt < cutoff) byKey.delete(key);
    }
  }

  // Create or update an entry. Preserves status/createdAt on an existing entry;
  // merges any extra fields (e.g. an id from a Webex flow). Returns null if the
  // phone number is missing/unusable.
  function register({ callerAni, id = null, ...extra } = {}) {
    prune();
    const key = normalizePhone(callerAni);
    if (!key) return null;
    const existing = byKey.get(key) ?? null;
    const entry = {
      ...(existing ?? {}),
      ...extra,
      callerAni,
      key,
      callerAniE164: toE164(callerAni),
      callerAniDisplay: toDisplay(callerAni),
      id: id ?? existing?.id ?? null,
      status: existing?.status ?? 'waiting',
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now()
    };
    byKey.set(key, entry);
    return entry;
  }

  function get(callerAni) {
    prune();
    return byKey.get(normalizePhone(callerAni)) ?? null;
  }

  // Mark a call activated (bridged). Returns the entry, or null if not found.
  function activate(callerAni, extra = {}) {
    const entry = byKey.get(normalizePhone(callerAni));
    if (!entry) return null;
    Object.assign(entry, extra, { status: 'activated', activatedAt: now(), updatedAt: now() });
    return entry;
  }

  function isActivated(callerAni) {
    return get(callerAni)?.status === 'activated';
  }

  // FIFO: the waiting entry with the earliest createdAt (longest in line). With
  // { claim: true } it marks that entry 'claimed' so the next call returns the
  // next-oldest instead of the same one. Returns null if nothing is waiting.
  function oldestWaiting({ claim = false } = {}) {
    prune();
    let oldest = null;
    for (const entry of byKey.values()) {
      if (entry.status !== 'waiting') continue;
      if (!oldest || entry.createdAt < oldest.createdAt) oldest = entry;
    }
    if (oldest && claim) {
      oldest.status = 'claimed';
      oldest.claimedAt = now();
      oldest.updatedAt = now();
    }
    return oldest;
  }

  function remove(callerAni) {
    return byKey.delete(normalizePhone(callerAni));
  }

  function all() {
    prune();
    return [...byKey.values()];
  }

  return { register, get, activate, isActivated, oldestWaiting, remove, all };
}
