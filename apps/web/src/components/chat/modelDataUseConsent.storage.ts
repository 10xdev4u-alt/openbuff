/**
 * Per-model data-use consent bookkeeping (the #157 gap's storage half).
 *
 * A consent must survive thread changes and app restarts — the gate exists so
 * a prompt NEVER goes out under disclosed supplier terms without an explicit
 * accept, and "I already accepted in another thread yesterday" is a valid
 * accept. Client-side only: this is a consent journal, not a setting; nothing
 * server-side consumes it.
 *
 * @module components/chat/modelDataUseConsent.storage
 */

const CONSENT_STORAGE_KEY = "t3code:data-use-consents:v1";

/**
 * The slug set whose rows the user has explicitly consented to. Unavailable
 * storage (non-browser test environments) reads as "never consented" — the
 * gate then asks on every send, fail-closed.
 */
export function readConsentedDataUseModelSlugs(): ReadonlyArray<string> {
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // Corrupt or unreadable storage must never widen what the user agreed
    // to — treat it as no consents on record.
    return [];
  }
}

/** Record an explicit consent for one model slug. Idempotent. */
export function rememberConsentedDataUseModelSlug(slug: string): void {
  const known = new Set(readConsentedDataUseModelSlugs());
  if (known.has(slug)) return;
  known.add(slug);
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify([...known]));
  } catch {
    // A full or blocked storage cannot fake a consent the user never gave;
    // dropping the record makes the next send re-ask, which is safe.
  }
}

/** Test/diagnostic escape hatch: forget every recorded consent. */
export function clearConsentedDataUseModelSlugs(): void {
  try {
    window.localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // Nothing to recover to; reads already fail closed.
  }
}
