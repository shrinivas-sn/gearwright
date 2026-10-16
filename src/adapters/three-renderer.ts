/**
 * L4 ADAPTER — Three.js renderer implementing `RenderPort` (ARCH §10 L4, ADR-003).
 *
 * Phase 1 (M0) scope: initialise WebGL2, present a basic placeholder scene, report
 * statistics, resize correctly, and dispose cleanly. It contains **no gameplay**.
 *
 * Boundaries respected:
 *  - This is the only place `three` is imported for rendering.
 *  - It never mutates game state; it renders whatever it is told to render.
 *  - `alpha` is accepted for API completeness and is presentation-only (ARCH §14).
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CharacterRig, type CharacterUpdate, type PlayerBody } from './character-rig.ts';
import {
  EMPTY_RENDER_STATS,
  type CameraPose,
  type CarryableRenderState,
  type CharacterFacts,
  type DebugRayState,
  type FeedbackPulseKind,
  type FeedbackPulseState,
  type FocusMarkerState,
  type LabWorldMesh,
  type PlayerMarkerState,
  type RenderPort,
  type RenderStats,
  type ScannerOverlayState,
  type ShotEffectsRenderState,
  type SnapMarkerState,
  type WeaponRenderState
} from '../ports/render-port.ts';

/** Pulse colours per feedback kind (ARCH §33.2 rule 4: always paired with shape/motion). */
const PULSE_COLORS: Record<FeedbackPulseKind, number> = {
  attach: 0x6be86b,
  refuse: 0xd2604f,
  detach: 0xe8b23a,
  complete: 0xbfe0ff
};

/**
 * Scanner reveal colours per role (M10, ARCH §29.3) — cool blue for what the requirement
 * names, instrument amber for what could satisfy it. The *shape* differs too (box vs
 * octahedron), so the two reads stay apart without colour (§33.2 rule 4).
 */
const SCANNER_COLORS: Record<'named' | 'candidate', number> = {
  named: 0xbfe0ff,
  candidate: 0xe8b23a
};

/** Flow-path capacity: a machine's chain is a handful of nodes, never a crowd. */
const SCANNER_ROUTE_CAPACITY = 64;

/**
 * Weapons pass (16/10/2026). The drawn weapon is built once along −Z from a tip at the local
 * origin, so placing the group at the muzzle and aiming its +Z along the shot direction puts the
 * barrel tip exactly where the bullet leaves — the picture and the simulation share one point by
 * construction, not by a tuned offset.
 */
const WEAPON_BODY_LENGTH = 0.34;
const WEAPON_BARREL_LENGTH = 0.3;
const WEAPON_STOCK_LENGTH = 0.24;
/** Pools, not growth: a sustained fight costs what a single shot costs (the plan's budget rule). */
const TRACER_CAPACITY = 24;
const IMPACT_CAPACITY = 16;

/** One procedural weapon: receiver + barrel + stock + magazine, merged into one draw call. */
function buildWeaponGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const push = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const box = new THREE.BoxGeometry(sx, sy, sz);
    box.translate(x, y, z);
    parts.push(box);
  };
  // Local −Z is *backwards* from the muzzle (the tip sits at the local origin).
  push(0, 0, -0.06, 0.07, 0.16, WEAPON_BODY_LENGTH);
  push(0, 0.015, -0.06 - WEAPON_BODY_LENGTH / 2 - WEAPON_BARREL_LENGTH / 2, 0.035, 0.035, WEAPON_BARREL_LENGTH);
  push(0, -0.02, -0.06 - WEAPON_BODY_LENGTH / 2 - WEAPON_STOCK_LENGTH / 2, 0.05, 0.1, WEAPON_STOCK_LENGTH);
  push(0, -0.13, -0.1, 0.05, 0.16, 0.1);
  const merged = mergeGeometries(parts, false) ?? parts[0] ?? new THREE.BoxGeometry(1, 1, 1);
  for (const part of parts) part.dispose();
  return merged;
}

/** Unit gear (fits a 1×1×1 box, centred, axis = Y) — scaled per part like the box. */
function buildGearGeometry(teeth: number): THREE.BufferGeometry {
  const outer = 0.5;
  const root = 0.4;
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i += 1) {
    const a0 = i * step;
    const points: ReadonlyArray<readonly [number, number]> = [
      [root, a0],
      [outer, a0 + step * 0.25],
      [outer, a0 + step * 0.5],
      [root, a0 + step * 0.75]
    ];
    for (const [radius, angle] of points) {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0 && radius === root && angle === a0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.12, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 12 });
  geometry.rotateX(-Math.PI / 2); // extrusion (+Z) becomes +Y
  geometry.translate(0, -0.5, 0); // centre the thickness
  return geometry;
}

/** Unit pipe segment with flanges (fits a 1×1×1 box, axis = X). */
function buildPipeGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.42, 0.42, 1, 20);
  body.rotateZ(Math.PI / 2);
  const flangeA = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20);
  flangeA.rotateZ(Math.PI / 2);
  flangeA.translate(-0.44, 0, 0);
  const flangeB = flangeA.clone();
  flangeB.translate(0.88, 0, 0);
  const merged = mergeGeometries([body, flangeA, flangeB], false);
  body.dispose();
  flangeA.dispose();
  flangeB.dispose();
  return merged ?? new THREE.BoxGeometry(1, 1, 1);
}

/** One pooled carryable visual: the mesh plus its own material (per-object tint). */
interface CarryableVisual {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly material: THREE.MeshStandardMaterial;
}

/** One pooled socket-marker visual (wireframe box, tinted per occupancy state). */
interface MarkerVisual {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
}

/**
 * One pooled scanner highlight (M10). The geometry is swapped per reveal because the
 * *role* decides the shape, and both geometries are shared, so switching is free.
 */
interface ScannerVisual {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
}

export interface RendererOptions {
  /** Cap on devicePixelRatio (quality tier dependent, ARCH §35.2). */
  readonly maxPixelRatio?: number;
  /** Draw a placeholder scene so baseline performance can be measured (dev/diagnostic). */
  readonly placeholderScene?: boolean;
}

export class ThreeRenderer implements RenderPort {
  readonly kind = 'three';

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private environment: THREE.Texture | null = null;
  private lights: THREE.Light[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private worldDisposables: Array<{ dispose(): void }> = [];
  private readonly options: Required<RendererOptions>;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private frameEmaMs = 16.7;
  private lastRenderAt = 0;
  private renderedFrames = 0;
  private degraded = false;
  /** The player's body: a procedurally-built skinned humanoid (see `character-rig.ts`). */
  private readonly character = new CharacterRig();
  /**
   * Whichever body is on screen. The procedural rig is the default and the fallback;
   * `upgradePlayerBody` swaps an imported humanoid in behind the same `PlayerBody` seam
   * (CHARACTER-3D.md §5), and nothing else in this file has to know which one it got.
   */
  private body: PlayerBody = this.character;
  /** One mutable buffer, rewritten every frame — `syncPlayerMarker` allocates nothing. */
  private readonly characterUpdate: CharacterUpdate = {
    position: { x: 0, y: 0, z: 0 },
    facingYaw: 0,
    speed: 0,
    walkSpeed: 1.8,
    runSpeed: 4.2,
    grounded: true,
    carrying: false,
    dt: 0,
    holdTarget: null,
    footGroundY: null,
    lookTarget: null,
    cameraDistance: Number.POSITIVE_INFINITY
  };
  /** One mutable foot-ground buffer, so the per-frame path allocates nothing. */
  private readonly footGround = { left: null as number | null, right: null as number | null };
  /** The focused object's point, kept from `setFocusMarker` so the head can look at it. */
  private readonly focusPoint = { x: 0, y: 0, z: 0 };
  private hasFocusPoint = false;
  /** Where the held part is, remembered from `setCarryables` (the grip target). */
  private readonly heldPartCenter = { x: 0, y: 0, z: 0 };
  private holding = false;
  private lastMarkerAt = 0;
  private readonly labGroup: THREE.Group;
  private readonly focusMarker: THREE.Mesh;
  private readonly debugRay: THREE.Line;
  /**
   * Carryables and socket markers are pooled by id (M6): the level authors a set,
   * and the renderer reuses one box per id across frames. Shared unit geometries
   * keep the draw cost flat as content grows.
   */
  private readonly carryableGeometry: THREE.BoxGeometry;
  private readonly gearGeometry: THREE.BufferGeometry;
  private readonly pipeGeometry: THREE.BufferGeometry;
  private readonly carryableVisuals = new Map<string, CarryableVisual>();
  private readonly markerGeometry: THREE.BoxGeometry;
  private readonly markerVisuals = new Map<string, MarkerVisual>();
  /**
   * Scanner reveal (M10, §29.3): one pooled highlight per entity id (a box for a named
   * entity, an octahedron for a candidate) plus a single flow-path polyline whose buffer
   * is written per reveal and drawn only as far as the route reaches.
   */
  private readonly scannerBoxGeometry: THREE.BoxGeometry;
  private readonly scannerShapeGeometry: THREE.OctahedronGeometry;
  private readonly scannerVisuals = new Map<string, ScannerVisual>();
  private readonly scannerRouteGeometry: THREE.BufferGeometry;
  private readonly scannerRoute: THREE.Line;
  private readonly scannerRouteMaterial: THREE.LineBasicMaterial;
  private readonly pulseMesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  private readonly pulseMaterial: THREE.MeshBasicMaterial;
  /**
   * Weapons pass: the drawn weapon (one merged mesh), a fixed tracer segment buffer (one
   * `LineSegments`, drawn as far as its draw range reaches), one muzzle flash, and the impact
   * marks as a **single instanced mesh** — one draw call for the whole pool, so the frame cost
   * of a shoot-out is constant rather than proportional to how many impacts are fading at once.
   * Everything here is created once (constructor) and rewritten in place.
   */
  private readonly weaponGroup: THREE.Group;
  private readonly weaponMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly tracerGeometry: THREE.BufferGeometry;
  private readonly tracerLine: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly flashMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly impactGeometry: THREE.OctahedronGeometry;
  private readonly impactMaterial: THREE.MeshBasicMaterial;
  private readonly impactMesh: THREE.InstancedMesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  /** Scratch for the per-frame instanced matrices — no allocation on the render path. */
  private readonly impactMatrix = new THREE.Matrix4();
  private readonly impactQuaternion = new THREE.Quaternion();
  private readonly impactScale = new THREE.Vector3();
  private readonly impactPosition = new THREE.Vector3();
  /** Scratch for aiming the weapon group — no allocation on the per-frame path. */
  private readonly muzzleScratch = new THREE.Vector3();
  private readonly aimScratch = new THREE.Vector3();
  private view: CameraPose | null = null;

  constructor(options: RendererOptions = {}) {
    this.options = {
      maxPixelRatio: options.maxPixelRatio ?? 1.5,
      placeholderScene: options.placeholderScene ?? false
    };
    this.labGroup = new THREE.Group();
    this.labGroup.visible = false;

    // Focus highlight (M2): a wireframe box parked on the focused target.
    this.focusMarker = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x74e0a8, wireframe: true, transparent: true, opacity: 0.9 })
    );
    this.focusMarker.visible = false;

    // Interaction ray debug line (M2, debug-only).
    const rayGeometry = new THREE.BufferGeometry();
    rayGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.debugRay = new THREE.Line(
      rayGeometry,
      new THREE.LineBasicMaterial({ color: 0x8ab4f8 })
    );
    this.debugRay.visible = false;

    // Carryables and socket markers (M6): one shared unit box each, scaled per
    // frame so the authored half extents stay the single source of truth. The
    // per-id meshes and materials are created lazily in `setCarryables` /
    // `setSnapMarkers`, because the level decides how many exist.
    this.carryableGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.gearGeometry = buildGearGeometry(12);
    this.pipeGeometry = buildPipeGeometry();
    this.markerGeometry = new THREE.BoxGeometry(1, 1, 1);

    // Feedback pulse (M6): one short, localised burst, drawn only while the L4
    // composer reports a strength above zero.
    this.pulseMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    this.pulseMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.pulseMaterial);
    this.pulseMesh.visible = false;

    // Scanner reveal (M10, §29.3): shared geometries (the role picks one) and a line
    // whose point buffer is sized once — a reveal never allocates a GPU resource.
    this.scannerBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.scannerShapeGeometry = new THREE.OctahedronGeometry(0.5, 0);
    this.scannerRouteGeometry = new THREE.BufferGeometry();
    this.scannerRouteGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SCANNER_ROUTE_CAPACITY * 3), 3)
    );
    this.scannerRouteGeometry.setDrawRange(0, 0);
    this.scannerRouteMaterial = new THREE.LineBasicMaterial({
      color: SCANNER_COLORS.named,
      transparent: true,
      opacity: 0.9
    });
    this.scannerRoute = new THREE.Line(this.scannerRouteGeometry, this.scannerRouteMaterial);
    this.scannerRoute.visible = false;
    this.scannerRoute.frustumCulled = false;

    // Weapons pass: one merged procedural weapon, a fixed-capacity tracer segment buffer (two
    // vertices per tracer, drawn as far as `drawRange` reaches), one flash and a pooled set of
    // impact marks. Nothing is added or removed at runtime.
    this.weaponGroup = new THREE.Group();
    this.weaponGroup.visible = false;
    this.weaponMesh = new THREE.Mesh(
      buildWeaponGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.55, metalness: 0.45 })
    );
    this.weaponMesh.castShadow = true;
    this.weaponGroup.add(this.weaponMesh);

    this.tracerGeometry = new THREE.BufferGeometry();
    this.tracerGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(TRACER_CAPACITY * 2 * 3), 3)
    );
    this.tracerGeometry.setDrawRange(0, 0);
    this.tracerLine = new THREE.LineSegments(
      this.tracerGeometry,
      new THREE.LineBasicMaterial({ color: 0xffd79a, transparent: true, opacity: 0.85 })
    );
    this.tracerLine.visible = false;
    this.tracerLine.frustumCulled = false;

    this.flashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9 })
    );
    this.flashMesh.visible = false;

    // Impacts: one instanced draw for the whole pool. (Per-mark meshes were the first cut;
    // they cost one draw call each the moment several marks are fading, which is exactly the
    // "stats() must not grow with how much you shoot" rule the plan sets.)
    this.impactGeometry = new THREE.OctahedronGeometry(0.5, 0);
    this.impactMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcf8a,
      transparent: true,
      opacity: 0.7
    });
    this.impactMesh = new THREE.InstancedMesh(
      this.impactGeometry,
      this.impactMaterial,
      IMPACT_CAPACITY
    );
    this.impactMesh.count = 0;
    this.impactMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.impactMesh.frustumCulled = false;
    this.impactMesh.visible = false;

    this.disposables.push(
      this.weaponMesh.geometry,
      this.weaponMesh.material,
      this.tracerGeometry,
      this.tracerLine.material,
      this.flashMesh.geometry,
      this.flashMesh.material,
      this.impactGeometry,
      this.impactMaterial,
      this.impactMesh,
      this.focusMarker.geometry,
      this.focusMarker.material as THREE.Material,
      rayGeometry,
      this.debugRay.material as THREE.Material,
      this.carryableGeometry,
      this.gearGeometry,
      this.pipeGeometry,
      this.markerGeometry,
      this.pulseMesh.geometry,
      this.pulseMaterial,
      this.scannerBoxGeometry,
      this.scannerShapeGeometry,
      this.scannerRouteGeometry,
      this.scannerRouteMaterial
    );
  }

  init(canvas: HTMLCanvasElement): boolean {
    if (this.renderer) return true;

    let renderer: THREE.WebGLRenderer;
    try {
      // a low-poly scene should not force a laptop's discrete GPU on
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'default' });
    } catch {
      // No WebGL2 / context creation refused -> caller surfaces EC-BRN-10.
      return false;
    }

    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      return false;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // PLAN T5.1: one shadow map. PCFSoftShadowMap was removed in r186 (it warns and falls back),
    // so PCFShadowMap is the correct soft-ish filter here.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x1b1d20, 1);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1d20);
    scene.fog = new THREE.Fog(0x1b1d20, 25, 70);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 400);
    camera.position.set(6, 5, 9);
    camera.lookAt(0, 0.6, 0);
    this.camera = camera;

    this.buildLights();
    this.buildPlaceholderScene();
    // The player's body is scene furniture from the start: it stays hidden until the first
    // `syncPlayerMarker`, which also positions it.
    scene.add(this.body.object);
    scene.add(this.labGroup);
    scene.add(this.focusMarker);
    scene.add(this.debugRay);
    scene.add(this.pulseMesh);
    scene.add(this.scannerRoute);
    scene.add(this.weaponGroup);
    scene.add(this.tracerLine);
    scene.add(this.flashMesh);
    scene.add(this.impactMesh);
    this.applyViewport();
    return true;
  }

  setView(pose: CameraPose): void {
    this.view = pose;
  }

  /** Rebuilds the static world: frees the previous build, then one merged mesh per colour. */
  setLabWorld(meshes: ReadonlyArray<LabWorldMesh>): void {
    // Free the previous build first: this runs on every hub stage and staged press.
    for (const item of this.worldDisposables) item.dispose();
    this.worldDisposables = [];
    this.labGroup.clear();

    // One merged mesh per colour: same look, a fraction of the draw calls.
    const byColor = new Map<number, THREE.BufferGeometry[]>();
    for (const mesh of meshes) {
      const sizeX = Math.max(0.001, mesh.max.x - mesh.min.x);
      const sizeY = Math.max(0.001, mesh.max.y - mesh.min.y);
      const sizeZ = Math.max(0.001, mesh.max.z - mesh.min.z);
      let geometry: THREE.BufferGeometry;
      if (mesh.kind === 'cylinder-z') {
        const radius = Math.min(sizeX, sizeY) / 2;
        geometry = new THREE.CylinderGeometry(radius, radius, sizeZ, 16);
        geometry.rotateX(Math.PI / 2);
      } else {
        geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
      }
      geometry.translate(mesh.min.x + sizeX / 2, mesh.min.y + sizeY / 2, mesh.min.z + sizeZ / 2);
      const list = byColor.get(mesh.color) ?? [];
      list.push(geometry);
      byColor.set(mesh.color, list);
    }
    for (const [color, geometries] of byColor) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.15 });
      this.worldDisposables.push(material);
      const merged = geometries.length === 1 ? geometries[0] ?? null : mergeGeometries(geometries, false);
      if (merged === null) {
        // Merge refused (never expected for boxes): fall back to one mesh per box.
        for (const geometry of geometries) {
          this.worldDisposables.push(geometry);
          const mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.labGroup.add(mesh);
        }
        continue;
      }
      if (geometries.length > 1) for (const geometry of geometries) geometry.dispose();
      this.worldDisposables.push(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.labGroup.add(mesh);
    }
    this.labGroup.visible = this.labGroup.children.length > 0;
  }

  /** Player-body facts for tooling (the harness asserts the body is built, drawn and placed). */
  characterFacts(): CharacterFacts {
    return this.body.facts();
  }

  /**
   * Swap the procedural body for an imported humanoid (ARCH §10 L4 · CHARACTER-3D.md §5). The
   * loader is imported lazily, so its chunk and the model are only ever fetched by a player who
   * gets this far; a refused fetch, a model without a skeleton, or a file with no idle/walk/run
   * clip leaves the procedural rig exactly where it was and reports `false`.
   *
   * The procedural rig is kept (hidden, out of the scene) rather than disposed: it is the fallback,
   * and re-mounting it costs nothing but an object swap.
   */
  async upgradePlayerBody(url: string): Promise<boolean> {
    if (this.scene === null) return false;
    const { loadGltfCharacter } = await import('./gltf-character.ts');
    const body = await loadGltfCharacter({ url });
    if (body === null) return false;
    this.scene.remove(this.character.object);
    this.scene.add(body.object);
    this.body = body;
    return true;
  }

  /**
   * Drive the player's body for this frame. The character animates itself from the state it is
   * handed here plus the held part it last saw in `setCarryables` (which runs later in the same
   * frame — a 33 ms lag on the grip, invisible and never fed back into logic).
   */
  syncPlayerMarker(state: PlayerMarkerState): void {
    const now = performance.now();
    const dt = this.lastMarkerAt > 0 ? Math.min(Math.max(now - this.lastMarkerAt, 0) / 1000, 0.25) : 0;
    this.lastMarkerAt = now;

    const update = this.characterUpdate;
    update.position.x = Number.isFinite(state.position.x) ? state.position.x : 0;
    update.position.y = Number.isFinite(state.position.y) ? state.position.y : 0;
    update.position.z = Number.isFinite(state.position.z) ? state.position.z : 0;
    update.facingYaw = Number.isFinite(state.facingYaw) ? state.facingYaw : 0;
    update.speed = state.speed;
    update.walkSpeed = state.walkSpeed;
    update.runSpeed = state.runSpeed;
    update.grounded = state.grounded;
    update.carrying = this.holding;
    update.dt = dt;
    update.holdTarget = this.holding ? this.heldPartCenter : null;
    // Copied into one mutable buffer: the rig keeps no reference to the caller's snapshot.
    const ground = state.footGroundY;
    if (ground === undefined) {
      update.footGroundY = null;
    } else {
      this.footGround.left = ground.left;
      this.footGround.right = ground.right;
      update.footGroundY = this.footGround;
    }
    const view = this.view;
    update.lookTarget = this.hasFocusPoint ? this.focusPoint : view === null ? null : view.target;
    update.cameraDistance =
      view === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(view.eye.x - update.position.x, view.eye.y - update.position.y, view.eye.z - update.position.z);
    this.body.update(update);
  }

  setFocusMarker(state: FocusMarkerState | null): void {
    if (!state) {
      this.focusMarker.visible = false;
      this.hasFocusPoint = false;
      return;
    }
    // The character looks at what the player is aiming at (falling back to the camera's aim).
    this.hasFocusPoint = true;
    this.focusPoint.x = state.point.x;
    this.focusPoint.y = state.point.y;
    this.focusPoint.z = state.point.z;
    this.focusMarker.position.set(state.point.x, state.point.y, state.point.z);
    this.focusMarker.visible = true;
  }

  setCarryables(states: ReadonlyArray<CarryableRenderState>): void {
    if (!this.scene) return;
    const seen = new Set<string>();
    let anyHeld = false;
    for (const state of states) {
      const { center, halfExtents } = state;
      seen.add(state.id);
      const visual = this.carryableVisual(state.id);
      const geometry =
        state.visual === 'gear' ? this.gearGeometry : state.visual === 'pipe' ? this.pipeGeometry : this.carryableGeometry;
      if (visual.mesh.geometry !== geometry) visual.mesh.geometry = geometry;
      visual.mesh.position.set(center.x, center.y, center.z);
      visual.mesh.scale.set(
        Math.max(0.001, halfExtents.x * 2),
        Math.max(0.001, halfExtents.y * 2),
        Math.max(0.001, halfExtents.z * 2)
      );
      // `spinAngle` is presentation-only motion added on top of the logical yaw
      // (M6): non-finite values can only come from a bad caller, never from logic.
      const yaw = Number.isFinite(state.yaw) ? state.yaw : 0;
      const spin = Number.isFinite(state.spinAngle) ? state.spinAngle : 0;
      visual.mesh.rotation.y = yaw + spin;
      // State is readable without colour alone (ARCH §18 feedback): held objects
      // glow warm, a refused step flashes the hazard tint.
      const color = state.blocked
        ? 0xd2604f
        : state.held
          ? 0xe8b23a
          : state.attached
            ? 0x6be86b
            : 0x5fb8a6;
      visual.material.color.setHex(color);
      const powered = state.powered === true && state.attached;
      visual.material.emissive.setHex(state.held ? 0x6b4d12 : powered ? 0x2f7a2f : state.attached ? 0x1c4a1c : 0x1f3f39);
      visual.material.emissiveIntensity = state.held ? 0.85 : powered ? 0.9 : 0.3;
      visual.mesh.visible = true;
      // The player's hands grip whatever this call says is held.
      if (state.held) {
        anyHeld = true;
        this.heldPartCenter.x = center.x;
        this.heldPartCenter.y = center.y;
        this.heldPartCenter.z = center.z;
      }
    }
    this.holding = anyHeld;
    // A component that left the level's set is hidden, not destroyed: the pool is
    // keyed by id and reused if it comes back.
    for (const [id, visual] of this.carryableVisuals) {
      if (!seen.has(id)) visual.mesh.visible = false;
    }
  }

  setSnapMarkers(states: ReadonlyArray<SnapMarkerState>): void {
    if (!this.scene) return;
    const seen = new Set<string>();
    for (const state of states) {
      seen.add(state.socketId);
      const visual = this.markerVisual(state.socketId);
      visual.mesh.position.set(state.center.x, state.center.y, state.center.z);
      visual.mesh.scale.set(
        Math.max(0.001, state.halfExtents.x * 2),
        Math.max(0.001, state.halfExtents.y * 2),
        Math.max(0.001, state.halfExtents.z * 2)
      );
      visual.material.color.setHex(
        state.state === 'occupied' ? 0x6be86b : state.state === 'preview' ? 0xe8b23a : 0x5fb8a6
      );
      visual.material.opacity = state.state === 'preview' ? 0.85 : 0.5;
      visual.mesh.visible = true;
    }
    for (const [id, visual] of this.markerVisuals) {
      if (!seen.has(id)) visual.mesh.visible = false;
    }
  }

  setFeedbackPulse(state: FeedbackPulseState | null): void {
    const strength = state ? Math.min(Math.max(state.strength, 0), 1) : 0;
    if (state === null || strength <= 0) {
      this.pulseMesh.visible = false;
      return;
    }
    const point = state.point;
    this.pulseMesh.position.set(point.x, point.y, point.z);
    // The burst grows as it fades, so the *shape* change carries the signal even
    // for a colour-blind player (§32.4 rule 2).
    this.pulseMesh.scale.setScalar(0.35 + 0.55 * (1 - strength));
    this.pulseMaterial.color.setHex(PULSE_COLORS[state.kind]);
    this.pulseMaterial.opacity = strength * 0.8;
    this.pulseMesh.visible = true;
  }

  /**
   * Scanner reveal (M10, ARCH §29.3): the entities a failed requirement points at, plus
   * the flow path between its endpoints. Two shapes keep the roles readable without
   * colour, the fade is the presenter's strength, and an id that is no longer revealed is
   * *hidden* rather than removed (pooled, like every other marker in this renderer).
   *
   * A malformed or empty state is drawn as nothing at all — never as an exception: this
   * is presentation, and §29.3 makes it visual-only by construction.
   */
  setScannerOverlay(state: ScannerOverlayState | null): void {
    const strength = state ? Math.min(Math.max(state.strength, 0), 1) : 0;
    if (state === null || strength <= 0) {
      for (const visual of this.scannerVisuals.values()) visual.mesh.visible = false;
      this.scannerRoute.visible = false;
      return;
    }

    const seen = new Set<string>();
    for (const target of state.targets) {
      if (!Number.isFinite(target.center.x) || !Number.isFinite(target.center.y) || !Number.isFinite(target.center.z)) {
        continue;
      }
      seen.add(target.id);
      const visual = this.scannerVisual(target.id);
      visual.mesh.geometry =
        target.role === 'named' ? this.scannerBoxGeometry : this.scannerShapeGeometry;
      visual.mesh.position.set(target.center.x, target.center.y, target.center.z);
      // A little margin so the highlight reads as a rig around the entity, not as a
      // second copy of it, and never degenerate for a wafer-thin part.
      visual.mesh.scale.set(
        Math.max(Math.abs(target.halfExtents.x) * 2 * 1.35, 0.18),
        Math.max(Math.abs(target.halfExtents.y) * 2 * 1.35, 0.18),
        Math.max(Math.abs(target.halfExtents.z) * 2 * 1.35, 0.18)
      );
      visual.material.color.setHex(SCANNER_COLORS[target.role]);
      visual.material.opacity = 0.35 + 0.55 * strength;
      visual.mesh.visible = true;
    }
    for (const [id, visual] of this.scannerVisuals) {
      if (!seen.has(id)) visual.mesh.visible = false;
    }

    // Flow path: one polyline, drawn as far as the route reaches. Fewer than two points
    // is not a path, so nothing is drawn (an endpoint pair is the presenter's fallback).
    const attribute = this.scannerRouteGeometry.getAttribute('position') as THREE.BufferAttribute;
    const count = Math.min(state.route.length, SCANNER_ROUTE_CAPACITY);
    for (let index = 0; index < count; index += 1) {
      const point = state.route[index];
      if (point === undefined) continue;
      attribute.setXYZ(index, point.x, point.y, point.z);
    }
    attribute.needsUpdate = true;
    this.scannerRouteGeometry.setDrawRange(0, count);
    this.scannerRouteMaterial.opacity = 0.35 + 0.55 * strength;
    this.scannerRoute.visible = count >= 2;
  }

  /** Reuse-or-create the pooled carryable visual for an id. */
  private carryableVisual(id: string): CarryableVisual {
    const existing = this.carryableVisuals.get(id);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({
      color: 0x5fb8a6,
      roughness: 0.4,
      metalness: 0.55,
      emissive: 0x1f3f39,
      emissiveIntensity: 0.3
    });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>(this.carryableGeometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.scene?.add(mesh);
    this.disposables.push(material);
    const visual: CarryableVisual = { mesh, material };
    this.carryableVisuals.set(id, visual);
    return visual;
  }

  /** Reuse-or-create the pooled socket-marker visual for a socket id. */
  private markerVisual(socketId: string): MarkerVisual {
    const existing = this.markerVisuals.get(socketId);
    if (existing) return existing;
    const material = new THREE.MeshBasicMaterial({
      color: 0x5fb8a6,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    const mesh = new THREE.Mesh(this.markerGeometry, material);
    mesh.visible = false;
    this.scene?.add(mesh);
    this.disposables.push(material);
    const visual: MarkerVisual = { mesh, material };
    this.markerVisuals.set(socketId, visual);
    return visual;
  }

  /**
   * Reuse-or-create the pooled scanner highlight for an entity id. One material per id,
   * so a role change (box ↔ octahedron) only swaps the shared geometry and re-tints.
   */
  private scannerVisual(id: string): ScannerVisual {
    const existing = this.scannerVisuals.get(id);
    if (existing) return existing;
    const material = new THREE.MeshBasicMaterial({
      color: SCANNER_COLORS.named,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(
      this.scannerBoxGeometry,
      material
    );
    mesh.visible = false;
    this.scene?.add(mesh);
    this.disposables.push(material);
    const visual: ScannerVisual = { mesh, material };
    this.scannerVisuals.set(id, visual);
    return visual;
  }

  setDebugRay(state: DebugRayState | null): void {
    if (!state) {
      this.debugRay.visible = false;
      return;
    }
    const attribute = this.debugRay.geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.setXYZ(0, state.origin.x, state.origin.y, state.origin.z);
    attribute.setXYZ(1, state.end.x, state.end.y, state.end.z);
    attribute.needsUpdate = true;
    (this.debugRay.material as THREE.LineBasicMaterial).color.setHex(state.hit ? 0x6be86b : 0x4a5568);
    this.debugRay.visible = true;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.pixelRatio = this.degraded ? 1 : Math.min(Math.max(0.5, pixelRatio), this.options.maxPixelRatio);

    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }
    this.applyViewport();
  }

  render(_alpha: number): void {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!renderer || !scene || !camera) return;

    // PLAN T5.4: if frames stay slow (EMA > 24 ms after 3 s of play), drop to pixel ratio 1 and
    // a 1024 shadow map once. Presentation only; never touches the simulation.
    const now = performance.now();
    if (this.lastRenderAt > 0) {
      const frameMs = now - this.lastRenderAt;
      if (frameMs < 250) this.frameEmaMs = this.frameEmaMs * 0.95 + frameMs * 0.05;
    }
    this.lastRenderAt = now;
    this.renderedFrames += 1;
    if (!this.degraded && this.renderedFrames > 180 && this.frameEmaMs > 24) {
      this.degraded = true;
      this.pixelRatio = 1;
      this.applyViewport();
      for (const light of this.lights) {
        if (light instanceof THREE.DirectionalLight && light.castShadow) {
          light.shadow.mapSize.set(1024, 1024);
          light.shadow.map?.dispose();
          light.shadow.map = null;
        }
      }
      console.info(`[render] sustained ${this.frameEmaMs.toFixed(1)} ms frames — pixel ratio 1, shadow map 1024`);
    }

    // Interpolation is visual-only (ADR-003): pose application never feeds back
    // into simulation state.
    const pose = this.view;
    if (pose) {
      camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
      if (Math.abs(camera.fov - pose.fov) > 1e-4) {
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
      }
    }
    renderer.render(scene, camera);
  }

  /**
   * Weapons pass: draw the held weapon, or hide it (`null`/holstered). The group is placed at
   * the muzzle the simulation fires from and aimed along the shot direction, so the drawn barrel
   * tip and the bullet's origin are the same point — no tuned offset to drift.
   */
  setWeaponView(state: WeaponRenderState | null): void {
    if (state === null || state.holstered) {
      this.weaponGroup.visible = false;
      return;
    }
    const muzzle = this.muzzleScratch.set(state.muzzle.x, state.muzzle.y, state.muzzle.z);
    this.aimScratch.set(state.aimDirection.x, state.aimDirection.y, state.aimDirection.z);
    if (
      !Number.isFinite(muzzle.x) || !Number.isFinite(muzzle.y) || !Number.isFinite(muzzle.z) ||
      this.aimScratch.lengthSq() < 1e-9
    ) {
      this.weaponGroup.visible = false;
      return;
    }
    this.aimScratch.normalize();
    this.weaponGroup.position.copy(muzzle);
    this.weaponGroup.lookAt(
      muzzle.x + this.aimScratch.x,
      muzzle.y + this.aimScratch.y,
      muzzle.z + this.aimScratch.z
    );
    // Aiming brings the weapon up to the sights: a small, readable shift rather than a rig.
    this.weaponGroup.position.y += 0.05 * Math.min(Math.max(state.adsBlend, 0), 1);
    this.weaponGroup.visible = true;
  }

  /**
   * Weapons pass: this frame's tracers, muzzle flash and impact marks. All three are fixed
   * pools — the tracer buffer's `drawRange` is the live count and the impact meshes are shown
   * and hidden in place — so the frame cost does not grow with how much was fired.
   */
  setShotEffects(state: ShotEffectsRenderState | null): void {
    if (state === null) {
      this.tracerLine.visible = false;
      this.flashMesh.visible = false;
      this.impactMesh.count = 0;
      this.impactMesh.visible = false;
      return;
    }

    const attribute = this.tracerGeometry.getAttribute('position') as THREE.BufferAttribute;
    let drawn = 0;
    let strongest = 0;
    for (const tracer of state.tracers) {
      if (drawn >= TRACER_CAPACITY) break;
      const { from, to } = tracer;
      if (
        !Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(from.z) ||
        !Number.isFinite(to.x) || !Number.isFinite(to.y) || !Number.isFinite(to.z)
      ) {
        continue;
      }
      attribute.setXYZ(drawn * 2, from.x, from.y, from.z);
      attribute.setXYZ(drawn * 2 + 1, to.x, to.y, to.z);
      drawn += 1;
      strongest = Math.max(strongest, tracer.strength);
    }
    if (drawn > 0) attribute.needsUpdate = true;
    this.tracerGeometry.setDrawRange(0, drawn * 2);
    this.tracerLine.visible = drawn > 0;
    this.tracerLine.material.opacity = 0.25 + 0.7 * Math.min(Math.max(strongest, 0), 1);

    const flash = Math.min(Math.max(state.muzzleFlash, 0), 1);
    this.flashMesh.visible = flash > 0;
    if (this.flashMesh.visible) {
      this.flashMesh.position.set(state.flashPoint.x, state.flashPoint.y, state.flashPoint.z);
      this.flashMesh.scale.setScalar(0.7 + 0.8 * flash);
      this.flashMesh.material.opacity = 0.35 + 0.6 * flash;
    }

    // Impacts: one instanced mesh, so N marks cost one draw call. The fade rides the mark's
    // *size* (the motion carries the signal, §33.2 rule 4) plus the strongest mark's opacity —
    // a per-instance opacity would need a shader for a read nobody can resolve at 0.16 m.
    let marks = 0;
    let strongestMark = 0;
    for (const impact of state.impacts) {
      if (marks >= IMPACT_CAPACITY) break;
      const strength = Math.min(Math.max(impact.strength, 0), 1);
      if (strength <= 0) continue;
      if (
        !Number.isFinite(impact.point.x) ||
        !Number.isFinite(impact.point.y) ||
        !Number.isFinite(impact.point.z)
      ) {
        continue;
      }
      this.impactPosition.set(impact.point.x, impact.point.y, impact.point.z);
      this.impactScale.setScalar(0.1 + 0.16 * strength);
      this.impactMatrix.compose(this.impactPosition, this.impactQuaternion, this.impactScale);
      this.impactMesh.setMatrixAt(marks, this.impactMatrix);
      marks += 1;
      strongestMark = Math.max(strongestMark, strength);
    }
    if (marks > 0) this.impactMesh.instanceMatrix.needsUpdate = true;
    this.impactMesh.count = marks;
    this.impactMesh.visible = marks > 0;
    this.impactMaterial.opacity = 0.25 + 0.6 * strongestMark;
  }

  stats(): RenderStats {
    const renderer = this.renderer;
    if (!renderer) return EMPTY_RENDER_STATS;
    const info = renderer.info;
    let visibleLights = 0;
    for (const light of this.lights) if (light.visible) visibleLights += 1;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      lights: visibleLights,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
  }

  dispose(): void {
    for (const item of this.worldDisposables) item.dispose();
    this.worldDisposables = [];
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.lights = [];
    this.character.dispose();
    if (this.body !== this.character) this.body.dispose?.();
    this.carryableVisuals.clear();
    this.markerVisuals.clear();
    this.scannerVisuals.clear();
    this.scannerRoute.visible = false;
    this.environment?.dispose();
    this.environment = null;
    this.scene?.clear();
    this.scene = null;
    this.camera = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private applyViewport(): void {
    this.renderer?.setPixelRatio(this.pixelRatio);
    this.renderer?.setSize(this.width, this.height, false);
  }

  private buildLights(): void {
    if (!this.scene || !this.renderer) return;
    const scene = this.scene;
    const hemisphere = new THREE.HemisphereLight(0xbfc6cf, 0x2a2e33, 0.7);
    scene.add(hemisphere);
    this.lights.push(hemisphere);

    const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
    key.position.set(10, 18, 8);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -24;
    shadowCamera.right = 24;
    shadowCamera.top = 24;
    shadowCamera.bottom = -24;
    shadowCamera.near = 1;
    shadowCamera.far = 70;
    shadowCamera.updateProjectionMatrix();
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);
    this.lights.push(key);

    // Soft studio reflections so metal reads as metal (no texture download).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environment = this.environment;
    scene.environmentIntensity = 0.35;
    room.dispose();
    pmrem.dispose();
  }

  /**
   * Grey-box placeholder so Phase 1 can confirm rendering + measure a baseline.
   * Replaced by real level data in later milestones; never load-bearing for logic.
   */
  private buildPlaceholderScene(): void {
    if (!this.options.placeholderScene || !this.scene) return;
    const scene = this.scene;

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.4, 40),
      new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.95, metalness: 0.05 })
    );
    ground.position.y = -0.2;
    scene.add(ground);
    this.track(ground);

    const grid = new THREE.GridHelper(40, 40, 0x6b7178, 0x2a2e33);
    grid.position.y = 0.002;
    scene.add(grid);
    this.disposables.push(grid.geometry, grid.material as THREE.Material);

    const boxGeometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const boxMaterial = new THREE.MeshStandardMaterial({ color: 0x8b939c, roughness: 0.7, metalness: 0.25 });
    this.disposables.push(boxGeometry, boxMaterial);

    const positions: ReadonlyArray<readonly [number, number, number]> = [
      [0, 0.6, 0],
      [2.1, 0.6, 0.8],
      [-1.9, 0.6, 1.4],
      [0.6, 1.8, -1.7]
    ];
    for (const [x, y, z] of positions) {
      const box = new THREE.Mesh(boxGeometry, boxMaterial);
      box.position.set(x, y, z);
      scene.add(box);
    }
  }

  private track(object: THREE.Mesh): void {
    this.disposables.push(object.geometry);
    const material = object.material;
    if (Array.isArray(material)) {
      this.disposables.push(...material);
    } else {
      this.disposables.push(material);
    }
  }
}