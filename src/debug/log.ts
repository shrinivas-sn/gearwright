/** Game log (PLAN T7.1): on in dev builds, or in any build with `?log=1` (the harness uses it). */
import { isDevBuild } from './flags.ts';

const enabled: boolean =
  isDevBuild || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('log'));

export function gameLog(...parts: unknown[]): void {
  if (enabled) console.info(...parts);
}
