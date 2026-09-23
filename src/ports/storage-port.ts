/**
 * L3 — storage port (ARCH §40 `ports/storage-port.ts`, §31.3).
 *
 * Interfaces only (ARCH §11 R4): the save layer talks to *this*, never to
 * `localStorage` or any other engine API, so tests can inject a fake that fails
 * mid-write (EC-SAVE-01/04/12) and IndexedDB can later replace localStorage
 * without touching a caller (OQ-2).
 *
 * The port is synchronous-by-shape (like `localStorage`), because the MVP write
 * protocol (§31.3) is "write pending → verify readback → promote", which is
 * easier to make crash-safe without asynchrony. Payloads are opaque strings:
 * only `SaveCodec` (L1) knows that a payload is a JSON save file, which keeps
 * "persistence only through DTOs" (R5) enforceable.
 */

/** The two canonical slots (ARCH §31.3). Settings writes go to the same slots. */
export type SaveSlotId = 'autosave' | 'checkpoint';

/** How much usable storage the underlying backend reports. Budget only (§31.4). */
export interface StorageQuota {
  /** Approximate bytes still available; `null` when the backend cannot say. */
  readonly remaining: number | null;
}

/**
 * Why a storage operation failed. Typed, because recovery behaviour differs
 * (EC-SAVE-12: quota is user-facing; corruption is load-path) and because "all
 * failures are typed, never silent" is §31.5's hard rule.
 */
export type StorageFailureCode = 'QuotaExceeded' | 'Unavailable' | 'WriteFailed';

export interface StorageFailure {
  readonly code: StorageFailureCode;
  /** Human-readable detail for the load log / console. Never a thrown error. */
  readonly detail: string;
}

export type StorageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: StorageFailure };

/**
 * One slot's view as the save layer sees it: the payload if a valid entry
 * exists, plus the write timestamp the newest-valid-wins rule (EC-SAVE-08)
 * compares. A `null` payload with a timestamp is a 'pending' tombstone from an
 * interrupted write — readable metadata, unusable data.
 */
export interface StorageEntry {
  readonly payload: string | null;
  readonly savedAt: number;
}

export interface StoragePort {
  /**
   * Read one slot's **current valid** entry, or `null` when the slot holds
   * none. An in-flight pending write never changes what `read` returns —
   * the previous good save stays loadable until promotion succeeds (§31.3).
   */
  read(slot: SaveSlotId): StorageEntry | null;
  /**
   * Begin the two-phase write: stage the payload *pending* without disturbing
   * the slot's current valid entry (§31.3: slot A stays untouched until
   * promotion). Fails typed, never throws.
   */
  writePending(slot: SaveSlotId, payload: string, savedAt: number): StorageResult;
  /**
   * §31.3's readback verification: true when the slot currently stages exactly
   * this payload as its pending write. The caller runs this before promoting.
   */
  verifyPending(slot: SaveSlotId, payload: string): boolean;
  /**
   * Second phase: the caller verified the pending payload and promotes it to
   * the slot's current valid save. The staged copy becomes the loadable one.
   */
  promote(slot: SaveSlotId): StorageResult;
  /** Remove one slot's entry entirely (New Game, recovery wipe). */
  clear(slot: SaveSlotId): StorageResult;
  /** True when the underlying backend is actually reachable. */
  isAvailable(): boolean;
  /** Best-effort budget report (§31.4); `remaining: null` when unknowable. */
  quota(): StorageQuota;
}
