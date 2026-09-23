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
import {
  EMPTY_RENDER_STATS,
  type CameraPose,
  type CarryableRenderState,
  type DebugRayState,
  type FeedbackPulseKind,
  type FeedbackPulseState,
  type FocusMarkerState,
  type LabWorldMesh,
  type PlayerMarkerState,
  type RenderPort,
  type RenderStats,
  type ScannerOverlayState,
  type SnapMarkerState
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

/** One pooled carryable visual: the mesh plus its own material (per-object tint). */
interface CarryableVisual {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
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
  private lights: THREE.Light[] = [];
  private disposables: Array<{ dispose(): void }> = [];
  private readonly options: Required<RendererOptions>;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private readonly marker: THREE.Group;
  private readonly markerDot: THREE.Mesh;
  private readonly markerMaterial: THREE.MeshStandardMaterial;
  private readonly labGroup: THREE.Group;
  private readonly focusMarker: THREE.Mesh;
  private readonly debugRay: THREE.Line;
  /**
   * Carryables and socket markers are pooled by id (M6): the level authors a set,
   * and the renderer reuses one box per id across frames. Shared unit geometries
   * keep the draw cost flat as content grows.
   */
  private readonly carryableGeometry: THREE.BoxGeometry;
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
  private view: CameraPose | null = null;

  constructor(options: RendererOptions = {}) {
    this.options = {
      maxPixelRatio: options.maxPixelRatio ?? 1.5,
      placeholderScene: options.placeholderScene ?? true
    };
    this.marker = new THREE.Group();
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8dee6,
      roughness: 0.5,
      metalness: 0.2,
      emissive: 0x6ba8e8,
      emissiveIntensity: 0.25
    });
    this.markerMaterial = markerMaterial;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.06, 4, 12), markerMaterial);
    body.position.y = 1.06;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xe8b23a })
    );
    dot.position.set(0, 1.55, -0.3);
    this.marker.add(body, dot);
    this.markerDot = dot;
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

    this.disposables.push(
      body.geometry,
      markerMaterial,
      dot.geometry,
      dot.material as THREE.Material,
      this.focusMarker.geometry,
      this.focusMarker.material as THREE.Material,
      rayGeometry,
      this.debugRay.material as THREE.Material,
      this.carryableGeometry,
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
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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

    this.buildPlaceholderScene();
    // The player marker is scene furniture from the start: Phase 1 shows the
    // lab without a player; Phase 2 moves the marker every frame.
    scene.add(this.marker);
    this.marker.visible = false;
    scene.add(this.labGroup);
    scene.add(this.focusMarker);
    scene.add(this.debugRay);
    scene.add(this.pulseMesh);
    scene.add(this.scannerRoute);
    this.applyViewport();
    return true;
  }

  setView(pose: CameraPose): void {
    this.view = pose;
  }

  setLabWorld(meshes: ReadonlyArray<LabWorldMesh>): void {
    // Idempotent: rebuilding the lab group is cheap and rare (world load only).
    this.labGroup.clear();
    for (const mesh of meshes) {
      if (mesh.kind !== 'box') continue;
      const sizeX = Math.max(0.001, mesh.max.x - mesh.min.x);
      const sizeY = Math.max(0.001, mesh.max.y - mesh.min.y);
      const sizeZ = Math.max(0.001, mesh.max.z - mesh.min.z);
      const geometry = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
      const material = new THREE.MeshStandardMaterial({
        color: mesh.color,
        roughness: 0.85,
        metalness: 0.15
      });
      const box = new THREE.Mesh(geometry, material);
      box.position.set(
        mesh.min.x + sizeX / 2,
        mesh.min.y + sizeY / 2,
        mesh.min.z + sizeZ / 2
      );
      this.disposables.push(geometry, material);
      this.labGroup.add(box);
    }
    this.labGroup.visible = this.labGroup.children.length > 0;
  }

  syncPlayerMarker(state: PlayerMarkerState): void {
    const x = Number.isFinite(state.position.x) ? state.position.x : 0;
    const y = Number.isFinite(state.position.y) ? state.position.y : 0;
    const z = Number.isFinite(state.position.z) ? state.position.z : 0;
    this.marker.position.set(x, y, z);
    this.marker.rotation.y = state.facingYaw;
    // Run feedback: brighter emissive while sprinting; dimmed when airborne.
    const running = state.speed > state.walkSpeed + (state.runSpeed - state.walkSpeed) * 0.5;
    this.markerMaterial.emissiveIntensity = state.grounded ? (running ? 0.75 : 0.25) : 0.1;
    // Facing dot sits on -Z; yaw 0 faces -Z, matching PlayerController.
    this.markerDot.position.set(0, 1.55, -0.3);
  }

  setFocusMarker(state: FocusMarkerState | null): void {
    if (!state) {
      this.focusMarker.visible = false;
      return;
    }
    this.focusMarker.position.set(state.point.x, state.point.y, state.point.z);
    this.focusMarker.visible = true;
  }

  setCarryables(states: ReadonlyArray<CarryableRenderState>): void {
    if (!this.scene) return;
    const seen = new Set<string>();
    for (const state of states) {
      const { center, halfExtents } = state;
      seen.add(state.id);
      const visual = this.carryableVisual(state.id);
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
      visual.material.emissive.setHex(state.held ? 0x6b4d12 : state.attached ? 0x1c4a1c : 0x1f3f39);
      visual.material.emissiveIntensity = state.held ? 0.85 : 0.3;
      visual.mesh.visible = true;
    }
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
      roughness: 0.6,
      metalness: 0.2,
      emissive: 0x1f3f39,
      emissiveIntensity: 0.3
    });
    const mesh = new THREE.Mesh(this.carryableGeometry, material);
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
    this.pixelRatio = Math.min(Math.max(0.5, pixelRatio), this.options.maxPixelRatio);

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

  stats(): RenderStats {
    const renderer = this.renderer;
    if (!renderer) return EMPTY_RENDER_STATS;
    const info = renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      lights: this.lights.filter((light) => light.visible).length,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
    this.disposables = [];
    this.lights = [];
    this.carryableVisuals.clear();
    this.markerVisuals.clear();
    this.scannerVisuals.clear();
    this.scannerRoute.visible = false;
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

  /**
   * Grey-box placeholder so Phase 1 can confirm rendering + measure a baseline.
   * Replaced by real level data in later milestones; never load-bearing for logic.
   */
  private buildPlaceholderScene(): void {
    if (!this.options.placeholderScene || !this.scene) return;
    const scene = this.scene;

    const hemisphere = new THREE.HemisphereLight(0xbfc6cf, 0x2a2e33, 1.1);
    scene.add(hemisphere);
    this.lights.push(hemisphere);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(8, 12, 6);
    scene.add(key);
    this.lights.push(key);

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