/**
 * L4 — player settings persisted in localStorage (PLAN T6.4), separate from save slots.
 */

export interface PlayerSettings {
  readonly sensitivity: number;
  readonly invertY: boolean;
  readonly volume: number;
}

export const DEFAULT_SETTINGS: PlayerSettings = { sensitivity: 1, invertY: false, volume: 0.8 };
const KEY = 'gearwright:settings';

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

export function loadSettings(): PlayerSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof PlayerSettings, unknown>>;
    return {
      sensitivity: clampNumber(parsed.sensitivity, 0.25, 3, DEFAULT_SETTINGS.sensitivity),
      invertY: parsed.invertY === true,
      volume: clampNumber(parsed.volume, 0, 1, DEFAULT_SETTINGS.volume)
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PlayerSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
