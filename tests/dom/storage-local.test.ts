import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalStorageAdapter } from '../../src/adapters/storage-local.ts';

/**
 * STORAGE ADAPTER (ARCH 31.3, TEST 11 "interrupted write", EC-SAVE-12).
 * jsdom gives us a real localStorage, so the two-phase pending-promote
 * protocol is exercised against the actual envelope bytes — plus stubbed
 * throwing backends for quota/unavailable paths, which real browsers make
 * impossible to reproduce deterministically.
 */

const PREFIX = 'gearwright-test';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Restore any stubbed backend (isolation for the rest of the suite).
  vi.unstubAllGlobals();
});

describe('LocalStorageAdapter — the two-phase write protocol', () => {
  it('a promoted write reads back byte-identical', () => {
    const adapter = new LocalStorageAdapter(PREFIX);
    const payload = '{"version":1,"meta":{"savedAt":1}}';

    expect(adapter.writePending('autosave', payload, 1000).ok).toBe(true);
    // Pending: nothing is loadable yet (no current save in a fresh slot).
    expect(adapter.read('autosave')).toBeNull();

    expect(adapter.promote('autosave').ok).toBe(true);
    expect(adapter.read('autosave')).toEqual({ payload, savedAt: 1000 });
    // The envelope really is in localStorage under the prefixed key, with the
    // payload nested (JSON-escaped) inside it.
    const envelope = JSON.parse(localStorage.getItem(`${PREFIX}:autosave`) ?? '{}') as {
      current?: { payload?: string };
    };
    expect(envelope.current?.payload).toBe(payload);
  });

  it('an interrupted write (never promoted) leaves the previous good save intact', () => {
    const adapter = new LocalStorageAdapter(PREFIX);
    adapter.writePending('checkpoint', '{"older":true}', 500);
    adapter.promote('checkpoint');

    // A later write staged as pending, then the process died: the staged copy
    // is ignored and the slot's current save (savedAt 500) still loads.
    adapter.writePending('checkpoint', '{"newer":true}', 900);
    expect(adapter.read('checkpoint')).toEqual({ payload: '{"older":true}', savedAt: 500 });
  });

  it('verifyPending byte-compares the staged copy', () => {
    const adapter = new LocalStorageAdapter(PREFIX);
    adapter.writePending('autosave', '{"a":1}', 10);
    expect(adapter.verifyPending('autosave', '{"a":1}')).toBe(true);
    expect(adapter.verifyPending('autosave', '{"a":2}')).toBe(false);
    expect(adapter.verifyPending('checkpoint', '{"a":1}')).toBe(false);
  });

  it('promote without a pending write fails typed, never throws', () => {
    const adapter = new LocalStorageAdapter(PREFIX);
    const result = adapter.promote('autosave');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('WriteFailed');
  });

  it('clear removes the slot entirely', () => {
    const adapter = new LocalStorageAdapter(PREFIX);
    adapter.writePending('autosave', '{}', 1);
    adapter.promote('autosave');
    expect(adapter.clear('autosave').ok).toBe(true);
    expect(adapter.read('autosave')).toBeNull();
  });

  it('a foreign key under the same storage is never touched', () => {
    const adapter = new LocalStorageAdapter(PREFIX);
    localStorage.setItem('something-else', 'keep me');
    adapter.clear('autosave');
    expect(localStorage.getItem('something-else')).toBe('keep me');
  });
});

describe('LocalStorageAdapter — hostile backends (EC-SAVE-12)', () => {
  it('quota errors map to the typed QuotaExceeded code', () => {
    vi.stubGlobal(
      'localStorage',
      {
        getItem: () => null,
        setItem: () => {
          const error = new Error('quota reached');
          error.name = 'QuotaExceededError';
          throw error;
        },
        removeItem: () => undefined
      }
    );
    const adapter = new LocalStorageAdapter(PREFIX);
    expect(adapter.isAvailable()).toBe(true);
    const result = adapter.writePending('autosave', '{}', 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe('QuotaExceeded');
  });

  it('a throwing probe (security exception) degrades to Unavailable, not a crash', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Access denied');
      }
    });
    const adapter = new LocalStorageAdapter(PREFIX);
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.read('autosave')).toBeNull();
    expect(adapter.writePending('autosave', '{}', 1).ok).toBe(false);
  });

  it('a missing backend entirely reads as null and writes fail typed', () => {
    vi.stubGlobal('localStorage', undefined);
    const adapter = new LocalStorageAdapter(PREFIX);
    expect(adapter.isAvailable()).toBe(false);
    expect(adapter.read('autosave')).toBeNull();
    expect(adapter.writePending('autosave', '{}', 1).ok).toBe(false);
    expect(adapter.promote('autosave').ok).toBe(false);
  });

  it('the real storage is back afterwards (isolation for the rest of the suite)', () => {
    expect(() => localStorage.setItem('probe', '1')).not.toThrow();
    localStorage.removeItem('probe');
  });
});
