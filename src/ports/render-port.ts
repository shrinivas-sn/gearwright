/**
 * L3 PORT — rendering. Interface only: no engine imports, no logic (ARCH §9/§10).
 * L2 gameplay code depends on this; L4 `ThreeRenderer` implements it.
 */

/** Engine-agnostic render statistics, used by the perf overlay and budgets (ARCH §36). */
export interface RenderStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly lights: number;
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
}

export const EMPTY_RENDER_STATS: RenderStats = {
  drawCalls: 0,
  triangles: 0,
  lights: 0,
  programs: 0,
  geometries: 0,
  textures: 0
};

/**
 * Camera pose handed to the renderer every frame. Produced by `CameraRig` (L2),
 * consumed by L4 — the interface version of ARCH §17's camera contract.
 */
export interface CameraPose {
  /** Camera world position. */
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  /** Look-at target world position. */
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
  /** Vertical field of view in degrees. */
  readonly fov: number;
}

/**
 * Render-side description of the Phase-2 lab arena: derived from the same
 * authored data as the physics colliders, translated into meshes by L4.
 * Never hand-authored in the renderer. Content grows in later milestones;
 * this list stays tiny by design.
 */
export interface LabWorldMesh {
  /** 'cylinder-z': a round bar along Z filling the box (shafts). */
  readonly kind: 'box' | 'cylinder-z';
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
  readonly color: number;
}

/**
 * A visible marker for the player capsule (Phase 2 only — the character mesh
 * arrives in a later milestone; ARCH forbids placeholder logic, not placeholders).
 */
export interface PlayerMarkerState {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly facingYaw: number;
  readonly grounded: boolean;
  readonly speed: number;
  readonly walkSpeed: number;
  readonly runSpeed: number;
  /**
   * Ground height under each foot, or null where nothing is under it (foot-planting addition).
   * Presentation only: the rig plants the legs on it and never reports back. Absent = no
   * planting, and the legs keep their authored gait pose.
   */
  readonly footGroundY?: { readonly left: number | null; readonly right: number | null } | undefined;
}

/**
 * Player-body facts for tooling (the browser harness and the debug overlay). Presentation only:
 * nothing here is read back into logic, and a port that draws no body may omit the method.
 *
 * Hands/hold are optional so old ports and test doubles keep compiling: when present the
 * harness can prove the grip (hands converge on the held part) rather than trusting a
 * screenshot.
 */
export interface CharacterFacts {
  /**
   * Which body is drawn — `'procedural'` (the generated rig) or `'gltf'` (an imported humanoid).
   * Tooling only: the harness reads it to know which bone/triangle numbers are meaningful.
   */
  readonly body?: 'procedural' | 'gltf' | undefined;
  readonly bones: number;
  readonly triangles: number;
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** World-space hand positions, when the port draws a body with hands. */
  readonly handL?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  readonly handR?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  /**
   * Unit direction each hand points (wrist → fingers), when the body can measure one. The `arms`
   * harness scenario reads this to prove a grip orients the hand at the thing it holds instead of
   * letting the clip spin it; a body with no finger bones simply omits it.
   */
  readonly handLForward?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  readonly handRForward?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  /** True while the hands are driven onto a grip target. */
  readonly holding?: boolean | undefined;
  /** World-space grip target the hands are driven onto, or null when the hands are free. */
  readonly hold?: { readonly x: number; readonly y: number; readonly z: number } | null | undefined;
}

/** Focus highlight produced by `InteractionSystem` (L2), consumed by L4 (M2). */
export interface FocusMarkerState {
  readonly id: string;
  readonly kind: string;
  readonly verb: string;
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * A carryable object as presented by L4 (M3 addition). The manipulation layer owns
 * the pose; the renderer only draws it — including the resting pose, which is why
 * carryables are not part of `LabWorldMesh`.
 */
export interface CarryableRenderState {
  readonly id: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  /**
   * Presentation-only spin phase in radians, added on top of `yaw` (M6). The L4
   * feedback composer advances it **only** while the component's machine actually
   * propagates (§32.3 layer 4: "no fake motion"), and nothing ever reads it back
   * into logic (§32.4 rule 1).
   */
  readonly spinAngle: number;
  /** Currently held by the player (distinct material treatment). */
  readonly held: boolean;
  /** Last step refused a move/rotate/place for this object (feedback tint). */
  readonly blocked: boolean;
  /** Docked in a socket (M4): the socket pose is canonical for it now. */
  readonly attached: boolean;
  /** Visual shape (PLAN T5.2). Absent = box. */
  readonly visual?: 'box' | 'gear' | 'pipe' | undefined;
  /** Part of a machine that is running right now (glow). Absent = false. */
  readonly powered?: boolean | undefined;
  /**
   * Part of a machine whose derived state declares it **over its own ceiling**
   * (`overpressure`, §24.1). Absent = false.
   *
   * A machine that is over-fed is still `running`, so without this a failed machine drew the
   * same healthy glow as a working one. Presentation only, derived from state, never written
   * back: §24 requires the hazard to be readable in the world and not only in the HUD.
   */
  readonly overpressured?: boolean | undefined;
  /**
   * The point on this part's surface nearest the player, when it is held — where the hands
   * close on it. The presenter computes it (§32 layer 4) because it already owns the
   * interpolated pose the hands must match; absent = the centre, which is only right for a
   * part small enough to grip in one hand.
   */
  readonly grip?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
}

/**
 * Socket occupancy/preview marker (M4 addition). ARCH §12.1: the occupancy visual
 * is *derived* from the LMG, so it is presentation-only state that the renderer
 * never writes back.
 */
export interface SnapMarkerState {
  readonly socketId: string;
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
  readonly state: 'available' | 'preview' | 'occupied';
}

/**
 * A short, localised feedback pulse (M6, ARCH §32.3 layers 3/5). Produced by the
 * L4 composer from a `FeedbackIntent`; it is purely visual and never the only
 * signal for something mechanically important (§32.4 rule 2 — the pulse always
 * accompanies a state change the player can also see in the world).
 */
export interface FeedbackPulseState {
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  readonly kind: FeedbackPulseKind;
  /** 1 at the pulse's start fading to 0; values ≤ 0 are never drawn. */
  readonly strength: number;
}

export type FeedbackPulseKind = 'attach' | 'refuse' | 'detach' | 'complete';

/** Debug-only interaction ray (ARCH §18 debug row / §37). */
export interface DebugRayState {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly end: { readonly x: number; readonly y: number; readonly z: number };
  readonly hit: boolean;
}

/**
 * One highlighted entity of the scanner reveal (M10, ARCH §29.3): a component or socket
 * a failed requirement points at, already resolved to world space by the composition
 * (the only layer that knows the level). `role` is the reveal's vocabulary — `named` =
 * the requirement names it, `candidate` = it could satisfy it — and each role is drawn
 * as its own *shape*, so the distinction never rides on colour alone (§33.2 rule 4).
 */
export interface ScannerOverlayTargetState {
  readonly id: string;
  readonly kind: 'component' | 'socket';
  readonly role: 'named' | 'candidate';
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly halfExtents: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * The §29.3 scanner reveal: highlight rig + flow-path overlay. Produced by the L4
 * presenter (which owns duration + cooldown) and drawn only while `strength` is above
 * zero. Purely visual: it cannot bypass interaction, and nothing here is ever read back
 * into logic (§29.3, §32.4 rule 1).
 */
export interface ScannerOverlayState {
  readonly targets: ReadonlyArray<ScannerOverlayTargetState>;
  /** Ordered world points of the flow path; fewer than two points draws nothing. */
  readonly route: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>;
  /** 1 at the reveal's start fading to 0; values ≤ 0 are never drawn. */
  readonly strength: number;
}

/**
 * The drawn weapon (weapons pass, 16/10/2026). Presentation only: the renderer draws a
 * procedural gun whose barrel tip sits on `muzzle` and which points along `aimDirection` —
 * the same point and direction the simulation fires from, so what the player sees and what
 * the bullet does cannot drift apart. The renderer never writes either back.
 */
export interface WeaponRenderState {
  readonly weaponId: string;
  readonly weaponClass: string;
  /** 0…1 aim blend: the weapon rises from the hip to the sights. */
  readonly adsBlend: number;
  /** True while the hands are full (carrying a part): no weapon is drawn at all. */
  readonly holstered: boolean;
  readonly muzzle: { readonly x: number; readonly y: number; readonly z: number };
  readonly aimDirection: { readonly x: number; readonly y: number; readonly z: number };
}

/** One tracer segment, already pooled and aged by the L4 presenter. */
export interface TracerRenderState {
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  readonly to: { readonly x: number; readonly y: number; readonly z: number };
  /** 1 at the shot fading to 0. */
  readonly strength: number;
}

/** A bullet strike, drawn as a short-lived pulse where it landed. */
export interface ImpactRenderState {
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  /** 1 at the strike fading to 0. */
  readonly strength: number;
}

/**
 * This frame's shot effects: pooled tracers, the muzzle flash, and the impacts still fading.
 * The L4 presenter owns every lifetime, so the renderer draws exactly what it is handed —
 * the same contract `setFeedbackPulse` and `setScannerOverlay` already use.
 */
export interface ShotEffectsRenderState {
  readonly tracers: ReadonlyArray<TracerRenderState>;
  /** 0…1 flash strength; ≤ 0 draws nothing. */
  readonly muzzleFlash: number;
  readonly flashPoint: { readonly x: number; readonly y: number; readonly z: number };
  readonly impacts: ReadonlyArray<ImpactRenderState>;
}

export interface RenderPort {
  /** Stable identifier for diagnostics/debug panels (e.g. `three`). */
  readonly kind: string;

  /**
   * Create GPU resources for the given canvas. Throws `WebGL2Unsupported`-class
   * failure only via the returned boolean; never partially initialises silently.
   */
  init(canvas: HTMLCanvasElement): boolean;

  /** Viewport changed (window resize / fullscreen / DPR change). */
  resize(width: number, height: number, pixelRatio: number): void;

  /**
   * Draw one frame.
   * @param alpha interpolation factor in [0,1) between the last two simulation
   *              states — **visual only**, never fed back into gameplay (ARCH §14).
   */
  render(alpha: number): void;

  /**
   * Apply the camera pose computed by `CameraRig` (L2). Called every frame
   * before `render`. Phase 2 addition — harmless for Phase 1 ports (no-ops allowed).
   */
  setView(pose: CameraPose): void;

  /**
   * Present the Phase-2 lab arena as render geometry. Called on world load /
   * changes only; Phase 2 addition. Ports that only do the Phase-1 placeholder
   * scene may leave this as a documented no-op.
   */
  setLabWorld(meshes: ReadonlyArray<LabWorldMesh>): void;

  /** Move and animate the player's body from the state the simulation publishes. */
  syncPlayerMarker(state: PlayerMarkerState): void;

  /**
   * Facts about the player's body, for tooling. Optional: a port that draws no body (the test
   * doubles) simply does not implement it, and callers use `renderPort.characterFacts?.()`.
   */
  characterFacts?(): CharacterFacts;

  /** Highlight the focused interactable, or clear it (`null`). M2 addition. */
  setFocusMarker(state: FocusMarkerState | null): void;

  /** Draw the interaction ray for debugging, or clear it (`null`). M2 addition. */
  setDebugRay(state: DebugRayState | null): void;

  /**
   * Present every authored carryable (M6 generalisation of the M3 single-object
   * call): the level's whole set, in level order. The renderer draws exactly these
   * and hides anything it drew before that is no longer present, so callers never
   * need to clear entries one by one.
   */
  setCarryables(states: ReadonlyArray<CarryableRenderState>): void;

  /**
   * Draw the socket markers (M6 generalisation of the M4 single-marker call): the
   * detection volumes, tinted by availability. An empty array clears them.
   */
  setSnapMarkers(states: ReadonlyArray<SnapMarkerState>): void;

  /**
   * Draw the current feedback pulse, or clear it (`null`). M6 addition — the L4
   * composer owns the timing; the renderer only draws what it is handed.
   */
  setFeedbackPulse(state: FeedbackPulseState | null): void;

  /**
   * Draw the scanner reveal, or clear it (`null`). M10 addition — §29.3's highlight rig
   * and flow-path overlay. The L4 presenter owns duration + cooldown (and therefore the
   * fade), so the renderer only draws what it is handed, exactly like the pulse above.
   */
  setScannerOverlay(state: ScannerOverlayState | null): void;

  /**
   * Draw the held weapon, or clear it (`null`). Optional: a port that draws no weapon (the
   * test doubles) simply omits it, and callers use `renderPort.setWeaponView?.(...)`.
   */
  setWeaponView?(state: WeaponRenderState | null): void;

  /** Draw this frame's tracers, muzzle flash and impacts, or clear them (`null`). Optional. */
  setShotEffects?(state: ShotEffectsRenderState | null): void;

  stats(): RenderStats;

  dispose(): void;
}