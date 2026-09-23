/**
 * L4 â€” localStorage implementation of `StoragePort` (ARCH Â§31.3, Â§40
 * `adapters/storage-local.ts`).
 *
 * Implements the crash-safe write protocol *within one slot* via a staged
 * pending copy:
 *
 *   writePending(slot)  â†’ slot stages `{ pending }`, `current` untouched
 *   verifyPending(slot) â†’ caller byte-compares the staged copy
 *   promote(slot)       â†’ the staged copy becomes `current` (loadable)
 *
 * The slot's current valid payload is only replaced by `promote()`; a crash
 * between `writePending` and `promote` leaves the previous good save intact â€”
 * exactly EC-SAVE-01/04's "previous good slot remains loadable". Quota and
 * unavailable-storage failures are typed results, never throws (EC-SAVE-12),
 * so the save layer can notify and continue.
 *
 * This adapter never parses game state: payloads are opaque strings (R5 â€” the
 * codec owns every byte of the format).
 */

import type {
  SaveSlotId,
  StorageEntry,
  StoragePort,
  StorageQuota,
  StorageResult
} from '../ports/storage-port.ts';

/** Internal envelope: the loadable save plus, optionally, a staged write. */
interface StoredEnvelope {
  /** The slot's current valid save (absent only before the first promotion). */
  readonly current?: { readonly payload: string; readonly savedAt: number } | undefined;
  /** A staged write awaiting verification + promotion (Â§31.3). */
  readonly pending?: { readonly payload: string; readonly savedAt: number } | undefined;
}

function storageOf(): Storage | null {
  // Wrapped so a security-exception localStorage (sandboxed iframe, some CI)
  // degrades to `Unavailable` instead of throwing into the caller.
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    // The access itself can throw (Chrome: "Access denied" on file:// in some
    // configurations); touching a key is the cheapest reliable probe.
    storage.getItem('__gw_probe__');
    return storage;
  } catch {
    return null;
  }
}


export class LocalStorageAdapter implements StoragePort {
  private readonly backend: Storage | null;
  private readonly keyPrefix: string;

  constructor(keyPrefix = 'gearwright') {
    this.backend = storageOf();
    this.keyPrefix = keyPrefix;
  }

  read(slot: SaveSlotId): StorageEntry | null {
    const envelope = this.readEnvelope(slot);
    if (envelope === null || envelope.current === undefined) return null;
    // Pending writes never change what `read` returns: the previous good save
    // stays loadable until promotion succeeds (Â§31.3).
    return { payload: envelope.current.payload, savedAt: envelope.current.savedAt };
  }

  writePending(slot: SaveSlotId, payload: string, savedAt: number): StorageResult {
    const existing = this.readEnvelope(slot);
    return this.writeEnvelope(slot, {
      ...(existing?.current ? { current: existing.current } : {}),
      pending: { payload, savedAt }
    });
  }

  verifyPending(slot: SaveSlotId, payload: string): boolean {
    const envelope = this.readEnvelope(slot);
    return envelope?.pending?.payload === payload;
  }

  promote(slot: SaveSlotId): StorageResult {
    const pending = this.readEnvelope(slot)?.pending;
    if (pending === undefined) {
      return {
        ok: false,
        failure: { code: 'WriteFailed', detail: `no pending write to promote in "${slot}"` }
      };
    }
    return this.writeEnvelope(slot, { current: { payload: pending.payload, savedAt: pending.savedAt } });
  }

  clear(slot: SaveSlotId): StorageResult {
    const storage = this.backend;
    if (!storage) return unavailable();
    try {
      storage.removeItem(this.key(slot));
      return { ok: true };
    } catch (error) {
      return { ok: false, failure: { code: 'WriteFailed', detail: messageOf(error) } };
    }
  }

  isAvailable(): boolean {
    return this.backend !== null;
  }

  quota(): StorageQuota {
    // localStorage has no byte API; `null` is the honest "unknowable" answer
    // and the save layer treats it as unknown budget (OQ-2 measures, not guesses).
    return { remaining: null };
  }

  // --- internals -----------------------------------------------------------------

  private readEnvelope(slot: SaveSlotId): StoredEnvelope | null {
    const storage = this.backend;
    if (!storage) return null;
    let raw: string | null;
    try {
      raw = storage.getItem(this.key(slot));
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const envelope = JSON.parse(raw) as StoredEnvelope;
      if (typeof envelope !== 'object' || envelope === null) return null;
      const current = envelope.current;
      const pending = envelope.pending;
      const validCurrent =
        current === undefined ||
        (typeof current.payload === 'string' && typeof current.savedAt === 'number');
      const validPending =
        pending === undefined ||
        (typeof pending.payload === 'string' && typeof pending.savedAt === 'number');
      if (!validCurrent || !validPending) return null;
      return envelope;
    } catch {
      return null;
    }
  }

  private writeEnvelope(slot: SaveSlotId, envelope: StoredEnvelope): StorageResult {
    const storage = this.backend;
    if (!storage) return unavailable();
    let serialized: string;
    try {
      serialized = JSON.stringify(envelope);
    } catch (error) {
      return { ok: false, failure: { code: 'WriteFailed', detail: messageOf(error) } };
    }
    try {
      storage.setItem(this.key(slot), serialized);
      return { ok: true };
    } catch (error) {
      return { ok: false, failure: { code: failureCodeOf(error), detail: messageOf(error) } };
    }
  }

  private key(slot: SaveSlotId): string {
    return `${this.keyPrefix}:${slot}`;
  }
}

function unavailable(): StorageResult {
  return { ok: false, failure: { code: 'Unavailable', detail: 'localStorage is not available' } };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * DOMException QuotaExceededError is the canonical quota signal; engines throw
 * differently-named errors for the same condition, so match the known names
 * and report anything else as a plain write failure.
 */
function failureCodeOf(error: unknown): 'QuotaExceeded' | 'WriteFailed' {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = messageOf(error);
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'QuotaExceeded';
  if (message.includes('quota') || message.includes('Quota')) return 'QuotaExceeded';
  return 'WriteFailed';
}

