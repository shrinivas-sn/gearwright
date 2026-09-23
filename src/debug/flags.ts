/**
 * DEV-ONLY debug flags (ARCH §37). Debug tooling is additive: disabling every flag
 * must leave gameplay behaviour byte-identical, and production builds default to all-off.
 */

export const isDevBuild: boolean = import.meta.env.DEV === true;

export interface DebugFlags {
  /** Frame-time / FPS / budget panel (F3). */
  readonly perfOverlay: boolean;
  /** Renderer statistics in the perf panel (draw calls, triangles, geometries). */
  readonly rendererStats: boolean;
  /** Log lifecycle transitions to the console. */
  readonly logLifecycle: boolean;
  /** Draw the interaction ray + candidate marker (M2 debug view, ARCH §18/§37). */
  readonly interactionRay: boolean;
  /** Log the L2 feedback intents the L4 composer receives (M6, ARCH §32.1). */
  readonly logFeedback: boolean;
}

export const DEBUG_FLAGS: DebugFlags = {
  perfOverlay: isDevBuild,
  rendererStats: isDevBuild,
  logLifecycle: isDevBuild,
  interactionRay: false,
  logFeedback: isDevBuild
};

/** Mutable view used by the settings/HUD layer later; keeps `DEBUG_FLAGS` a default. */
export const debugFlagState = { ...DEBUG_FLAGS };