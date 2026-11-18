export interface ReviewCommandIdentity {
  actorId: string;
  reportId: string;
  revisionNo: number;
  decision: string;
  notes: string;
}

export interface StoredReviewCommand {
  fingerprint: string;
  idempotencyKey: string;
}

const REVIEW_COMMAND_STORAGE_PREFIX = "idaroh:review-command:";

export function localCommandDigest(value: string): string {
  // This digest is only a local storage discriminator. The server still
  // computes and verifies the authoritative command hash.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function reviewCommandFingerprint(identity: ReviewCommandIdentity): string {
  return `${identity.actorId}:${identity.reportId}:${identity.revisionNo}:${identity.decision}:${localCommandDigest(identity.notes)}`;
}

export function reviewCommandStorageKey(
  identity: Pick<ReviewCommandIdentity, "actorId" | "reportId" | "revisionNo" | "decision">,
): string {
  return `${REVIEW_COMMAND_STORAGE_PREFIX}${encodeURIComponent(
    `${identity.actorId}:${identity.reportId}:${identity.revisionNo}:${identity.decision}`,
  )}`;
}

export function readStoredReviewCommand(storageKey: string): StoredReviewCommand | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fingerprint?: unknown; idempotencyKey?: unknown };
    if (typeof parsed.fingerprint !== "string" || typeof parsed.idempotencyKey !== "string") return null;
    return { fingerprint: parsed.fingerprint, idempotencyKey: parsed.idempotencyKey };
  } catch {
    return null;
  }
}

export function storeReviewCommand(storageKey: string, command: StoredReviewCommand): void {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(command));
  } catch {
    // Memory-only fallback remains available when browser storage is blocked.
    // Retry after a page refresh is NOT possible in that state.
  }
}

export function clearStoredReviewCommand(storageKey: string): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // No-op: the command has still been cleared from memory.
  }
}

/** Reuse the in-flight key for the exact same command; otherwise recover the
 * stored key (same tab, survives refresh) or mint a new intentional command. */
export function resolveReviewCommand(
  identity: ReviewCommandIdentity,
  memoryCommand: StoredReviewCommand | null,
): { storageKey: string; fingerprint: string; idempotencyKey: string } {
  const fingerprint = reviewCommandFingerprint(identity);
  const storageKey = reviewCommandStorageKey(identity);
  const storedCommand = readStoredReviewCommand(storageKey);
  const idempotencyKey =
    memoryCommand?.fingerprint === fingerprint
      ? memoryCommand.idempotencyKey
      : storedCommand?.fingerprint === fingerprint
      ? storedCommand.idempotencyKey
      : crypto.randomUUID();
  return { storageKey, fingerprint, idempotencyKey };
}