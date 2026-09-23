import { describe, expect, it } from 'vitest';

import {
  ActionHistory,
  coversAll,
  DEFAULT_ACTION_LIMIT,
  witnessesInOrder,
  type ActionHistorySnapshot
} from '../../src/game-state/action-history.ts';

describe('ActionHistory — the §12.2 staged log (ADR-018)', () => {
  it('starts empty and records in order', () => {
    const history = new ActionHistory();
    expect(history.size).toBe(0);
    expect(history.actions).toEqual([]);
    expect(history.append('bm1/prime-feed')).toBe(true);
    expect(history.append('bm1/prime-return')).toBe(true);
    expect(history.actions).toEqual(['bm1/prime-feed', 'bm1/prime-return']);
    expect(history.size).toBe(2);
  });

  it('refuses blank actions and trims whitespace', () => {
    const history = new ActionHistory();
    expect(history.append('   ')).toBe(false);
    expect(history.append('  bm1/prime-feed  ')).toBe(true);
    expect(history.actions).toEqual(['bm1/prime-feed']);
    expect(history.size).toBe(1);
  });

  it('allows the same action twice: a re-press is a legal recovery', () => {
    const history = new ActionHistory();
    history.append('bm1/engage');
    history.append('bm1/engage');
    expect(history.count('bm1/engage')).toBe(2);
    expect(history.indexOf('bm1/engage')).toBe(0);
    expect(history.indexOf('bm1/engage', 1)).toBe(1);
  });

  it('assigns monotonic sequence numbers that survive a round trip', () => {
    const history = new ActionHistory();
    history.append('a');
    history.append('b');
    expect(history.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    const snapshot = history.snapshot();
    const restored = new ActionHistory();
    restored.restore(snapshot);
    expect(restored.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(restored.actions).toEqual(['a', 'b']);
  });

  it('caps the log at the bound, oldest first (FIFO)', () => {
    const history = new ActionHistory({ limit: 3 });
    history.append('one');
    history.append('two');
    history.append('three');
    history.append('four');
    expect(history.actions).toEqual(['two', 'three', 'four']);
    expect(history.size).toBe(3);
  });

  it('clamps a degenerate limit to keeping one record', () => {
    const history = new ActionHistory({ limit: 0 });
    history.append('one');
    history.append('two');
    expect(history.actions).toEqual(['two']);
  });

  it('coversAll answers order-flexible priming ("any order" per §7)', () => {
    const priming = ['bm1/prime-feed', 'bm1/prime-return', 'bm1/prime-bleed'];
    expect(coversAll(['bm1/prime-bleed', 'bm1/prime-feed', 'bm1/prime-return'], priming)).toBe(true);
    expect(coversAll(['bm1/prime-feed', 'bm1/prime-return'], priming)).toBe(false);
    expect(coversAll(['bm1/prime-feed', 'bm1/prime-return', 'bm1/prime-bleed', 'bm1/engage'], priming)).toBe(
      true
    );
    expect(coversAll([], [])).toBe(true);
  });

  it('witnessesInOrder matches earliest-match: witnesses must appear in order', () => {
    const steps: ReadonlyArray<ReadonlyArray<string>> = [
      ['bm1/prime-feed', 'bm1/prime-return', 'bm1/prime-bleed'],
      ['bm1/engage']
    ];
    expect(witnessesInOrder(['bm1/prime-feed', 'bm1/prime-return', 'bm1/prime-bleed', 'bm1/engage'], steps)).toBe(
      true
    );
    expect(witnessesInOrder(['bm1/prime-bleed', 'bm1/engage'], steps)).toBe(true);
    expect(witnessesInOrder(['bm1/engage', 'bm1/prime-feed'], steps)).toBe(false);
    expect(witnessesInOrder(['bm1/engage', 'bm1/prime-feed', 'bm1/engage'], steps)).toBe(true);
    expect(witnessesInOrder(['bm1/prime-feed'], steps)).toBe(false);
    expect(witnessesInOrder([], steps)).toBe(false);
    expect(witnessesInOrder(['x'], [])).toBe(true);
    expect(witnessesInOrder(['x'], [[]])).toBe(false);
  });
});

describe('ActionHistory — persistence (§31.1) and resets', () => {
  it('restores the order and skips malformed entries, never throwing', () => {
    const history = new ActionHistory();
    history.append('kept');
    history.restore({ actions: ['b', '  ', 'c'] } as unknown as ActionHistorySnapshot);
    expect(history.actions).toEqual(['b', 'c']);
    history.restore({ actions: 'not-an-array' } as unknown as ActionHistorySnapshot);
    expect(history.actions).toEqual([]);
  });

  it('restore honours the bound and bumps the version', () => {
    const history = new ActionHistory({ limit: 2 });
    const before = history.version;
    history.restore({ actions: ['a', 'b', 'c'] });
    expect(history.actions).toEqual(['b', 'c']);
    expect(history.version).toBeGreaterThan(before);
  });

  it('the version moves on every mutation so the world need not compare arrays', () => {
    const history = new ActionHistory();
    const versions = new Set([history.version]);
    history.append('a');
    versions.add(history.version);
    history.resetAll();
    versions.add(history.version);
    expect(versions.size).toBe(3);
  });

  it('resetAll clears the log for a New Game (§25)', () => {
    const history = new ActionHistory();
    history.append('bm1/prime-feed');
    history.resetAll();
    expect(history.size).toBe(0);
    expect(history.has('bm1/prime-feed')).toBe(false);
    history.append('bm1/prime-feed');
    expect(history.coversAll(['bm1/prime-feed'])).toBe(true);
  });

  it('the default bound is far above anything staged content needs', () => {
    expect(DEFAULT_ACTION_LIMIT).toBeGreaterThanOrEqual(64);
  });
});
