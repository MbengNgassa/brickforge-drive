import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  MAX_BRICKS,
  PARTS_MAP,
  PLATE_HEIGHT,
  STUD_SIZE,
  getBrickCenterWorld,
  getOccupiedKeys,
  getRotatedDims,
} from './catalog';
import { createBrickMesh, createGarageFloorTexture } from './brickMesh';
import { makeUid } from './blueprints';
import { sound } from './audio';
import type { GraphicsEngine } from './engine';
import type { BrickPartId, BuilderTool, PlacedBrick, VehicleBlueprint } from './types';

interface SnapCandidate {
  gx: number;
  gy: number;
  gz: number;
  valid: boolean;
}

/**
 * Interactive 3D Brick Vehicle Garage Builder.
 * Supports stud-grid face snapping, green 3D target brackets, mirror symmetry,
 * paint/erase tools, undo/redo, and smooth desktop + mobile touch controls.
 */
export class GarageController {
  private engine: GraphicsEngine;
  private controls: OrbitControls | null = null;
  private bricks: PlacedBrick[] = [];
  private brickMeshes = new Map<string, THREE.Group>();
  private occupied = new Map<string, string>(); // cellKey -> brick uid
  private vehicleGroup = new THREE.Group();
  private buildPlane!: THREE.Mesh;

  private ghostGroup: THREE.Group | null = null;
  private snapBracketGroup = new THREE.Group();
  private bracketMatValid = new THREE.MeshBasicMaterial({ color: 0x22e56b, transparent: true, opacity: 0.92 });
  private bracketMatInvalid = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.92 });
  private bracketMatSelect = new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.95 });
  private hoverHighlight: THREE.LineSegments | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0, time: 0 };
  private isPointerDown = false;
  private lastCandidate: SnapCandidate | null = null;
  private hoveredBrickUid: string | null = null;
  public selectedBrickUid: string | null = null;
  private lastPlacedUid: string | null = null;

  public activePartId: BrickPartId = 'brick_2x4';
  public activeColor = '#d92626';
  public activeRot: 0 | 1 | 2 | 3 = 0;
  public activeTool: BuilderTool = 'place';
  public mirrorX = false;

  private undoStack: PlacedBrick[][] = [];
  private redoStack: PlacedBrick[][] = [];
  private popAnimations: { group: THREE.Group; t: number }[] = [];
  private pulseTime = 0;
  private active = false;
  public placedCountSession = 0;

  private onChange: () => void;

  constructor(engine: GraphicsEngine, onChange: () => void) {
    this.engine = engine;
    this.onChange = onChange;
  }

  public enter(blueprint: VehicleBlueprint): void {
    this.active = true;
    this.engine.setBloomEnabled(false);
    this.engine.clearScene();
    const scene = this.engine.scene;

    // Clean mid-slate workshop studio atmosphere so every brick color pops sharply
    scene.background = new THREE.Color(0x232d3b);
    scene.fog = new THREE.Fog(0x232d3b, 48, 120);

    // Balanced studio 3-point lighting (rich saturated ABS colors, crisp shadows, zero glare)
    const hemi = new THREE.HemisphereLight(0xf1f5f9, 0x26303d, 0.72);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff9f0, 1.55);
    keyLight.position.set(14, 24, 16);
    keyLight.castShadow = true;
    const sm = this.engine.getShadowMapSize();
    keyLight.shadow.mapSize.set(sm, sm);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 65;
    keyLight.shadow.camera.left = -16;
    keyLight.shadow.camera.right = 16;
    keyLight.shadow.camera.top = 16;
    keyLight.shadow.camera.bottom = -16;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7cc4ff, 0.55);
    rimLight.position.set(-14, 11, -14);
    scene.add(rimLight);

    // Matte-satin studio floor with tile texture
    const floorTex = createGarageFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.62,
        metalness: 0.05,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -PLATE_HEIGHT * 1.4;
    floor.receiveShadow = true;
    scene.add(floor);

    // Turntable workshop ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(8.8, 9.3, 64),
      new THREE.MeshBasicMaterial({ color: 0xf4be17, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -PLATE_HEIGHT * 1.36;
    scene.add(ring);

    // Front-direction chevron on the floor so builders always know which way is forward (+Z)
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 1.2);
    arrowShape.lineTo(0.95, -0.45);
    arrowShape.lineTo(0.36, -0.45);
    arrowShape.lineTo(0.36, -1.1);
    arrowShape.lineTo(-0.36, -1.1);
    arrowShape.lineTo(-0.36, -0.45);
    arrowShape.lineTo(-0.95, -0.45);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(Math.PI / 2);
    const arrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    arrow.position.set(0, -PLATE_HEIGHT * 1.34, 7.6);
    scene.add(arrow);

    // Invisible stud-grid build floor at y=0 for placing base bricks
    this.buildPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(24 * STUD_SIZE, 24 * STUD_SIZE),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.buildPlane.rotation.x = -Math.PI / 2;
    this.buildPlane.position.y = 0;
    scene.add(this.buildPlane);

    // Subtle build-bay stud grid lines at y=0
    const grid = new THREE.GridHelper(20 * STUD_SIZE, 20, 0x64748b, 0x475569);
    grid.position.y = -PLATE_HEIGHT * 1.33;
    scene.add(grid);

    // Vehicle container & snap brackets
    this.vehicleGroup = new THREE.Group();
    scene.add(this.vehicleGroup);

    this.snapBracketGroup = new THREE.Group();
    this.snapBracketGroup.visible = false;
    scene.add(this.snapBracketGroup);

    // Setup OrbitControls with responsive portrait/landscape framing
    const cam = this.engine.camera;
    this.controls = new OrbitControls(cam, this.engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 5.0;
    this.controls.maxDistance = 32;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    // Gentle turntable rotation until the user touches or drags the vehicle
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.9;

    this.loadBricks(blueprint.bricks, false);
    this.recenterCamera();
    this.rebuildGhostMesh();
    this.showAutoPreview();
    this.bindEvents();
  }

  /**
   * Automatically frames the entire 3D vehicle cleanly in the open viewport
   * on both tall portrait mobile screens and wide desktop screens.
   */
  public recenterCamera(): void {
    if (!this.controls) return;
    const cam = this.engine.camera;
    const isPortrait = window.innerHeight > window.innerWidth;

    const box = new THREE.Box3();
    if (this.vehicleGroup.children.length > 0) {
      box.setFromObject(this.vehicleGroup);
    } else {
      box.set(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 3, 4));
    }
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z, 6.5);
    cam.fov = isPortrait ? 50 : 46;
    cam.updateProjectionMatrix();

    // Shift look target slightly downward on portrait phones so the vehicle sits
    // squarely in the wide-open upper-middle window above the bottom brick tray!
    const yOffset = isPortrait ? -0.9 : -0.15;
    this.controls.target.set(center.x, center.y + yOffset, center.z);

    const dist = isPortrait ? maxDim * 1.62 : maxDim * 1.15;
    cam.position.set(
      center.x + dist * 0.72,
      center.y + dist * (isPortrait ? 0.5 : 0.44),
      center.z + dist * 0.78
    );
    this.controls.update();
  }

  public exit(): void {
    this.active = false;
    this.unbindEvents();
    this.controls?.dispose();
    this.controls = null;
    this.ghostGroup = null;
    this.hoverHighlight = null;
    this.brickMeshes.clear();
    this.occupied.clear();
    this.popAnimations = [];
  }

  public getBricks(): PlacedBrick[] {
    return this.bricks.map((b) => ({ ...b }));
  }

  public loadBricks(newBricks: PlacedBrick[], recordUndo = true): void {
    if (recordUndo) {
      this.pushUndo();
    } else {
      this.undoStack = [];
      this.redoStack = [];
    }
    this.bricks = newBricks.map((b) => ({ ...b }));
    this.rebuildAllMeshes();
    this.onChange();
  }

  public setPart(partId: BrickPartId): void {
    this.activePartId = partId;
    if (this.activeTool !== 'place') this.activeTool = 'place';
    this.rebuildGhostMesh();
    this.showAutoPreview();
    sound.playUiTick();
    this.onChange();
  }

  public setColor(hex: string): void {
    this.activeColor = hex;
    this.rebuildGhostMesh();
    if (this.activeTool === 'place') this.showAutoPreview();
    sound.playUiTick();
    this.onChange();
  }

  public setTool(tool: BuilderTool): void {
    this.activeTool = tool;
    if (this.ghostGroup) this.ghostGroup.visible = false;
    this.snapBracketGroup.visible = false;
    this.clearHoverHighlight();

    if (tool === 'place') {
      this.selectedBrickUid = null;
      this.rebuildSnapBracketsForDims(
        getRotatedDims(PARTS_MAP[this.activePartId], this.activeRot),
        this.bracketMatValid
      );
      this.showAutoPreview();
    } else if (tool === 'move') {
      // Auto-select the last placed brick (or topmost brick) so user can nudge immediately!
      const fallback =
        this.bricks.find((b) => b.uid === this.lastPlacedUid) ||
        [...this.bricks].sort((a, b) => b.gy - a.gy)[0] ||
        null;
      this.selectBrick(fallback ? fallback.uid : null, false);
    } else {
      this.selectedBrickUid = null;
    }

    sound.playUiTick();
    this.onChange();
  }

  public getSelectedBrick(): PlacedBrick | null {
    if (!this.selectedBrickUid) return null;
    return this.bricks.find((b) => b.uid === this.selectedBrickUid) || null;
  }

  public selectBrick(uid: string | null, notify = true): void {
    this.selectedBrickUid = uid;
    this.refreshSelectionVisual();
    if (notify) this.onChange();
  }

  private refreshSelectionVisual(): void {
    if (this.activeTool !== 'move') return;
    const brick = this.getSelectedBrick();
    if (!brick) {
      this.snapBracketGroup.visible = false;
      return;
    }
    const part = PARTS_MAP[brick.partId];
    const dims = getRotatedDims(part, brick.rot);
    const center = getBrickCenterWorld(brick);
    this.rebuildSnapBracketsForDims(dims, this.bracketMatSelect);
    this.snapBracketGroup.position.set(center.x, center.y, center.z);
    this.snapBracketGroup.visible = true;
  }

  public rotatePart(): void {
    if (this.activeTool === 'move') {
      const idx = this.bricks.findIndex((b) => b.uid === this.selectedBrickUid);
      if (idx >= 0) {
        const cur = this.bricks[idx];
        const nextRot = ((cur.rot + 1) % 4) as 0 | 1 | 2 | 3;
        if (this.isPlacementValid(cur.partId, cur.gx, cur.gy, cur.gz, nextRot, cur.uid)) {
          this.pushUndo();
          this.bricks[idx] = { ...cur, rot: nextRot };
          this.rebuildAllMeshes();
          this.refreshSelectionVisual();
          sound.playBrickSnap();
          this.onChange();
        } else {
          sound.playBrickRemove();
        }
      }
      return;
    }

    this.activeRot = ((this.activeRot + 1) % 4) as 0 | 1 | 2 | 3;
    this.rebuildGhostMesh();
    if (this.activeTool === 'place') {
      if (this.lastCandidate) {
        const valid = this.isPlacementValid(
          this.activePartId,
          this.lastCandidate.gx,
          this.lastCandidate.gy,
          this.lastCandidate.gz,
          this.activeRot
        );
        this.applyCandidatePreview(this.lastCandidate.gx, this.lastCandidate.gy, this.lastCandidate.gz, valid);
      } else {
        this.showAutoPreview();
      }
    }
    sound.playUiTick();
    this.onChange();
  }

  public deleteSelected(): void {
    if (this.activeTool !== 'move' || !this.selectedBrickUid || this.bricks.length <= 1) return;
    this.pushUndo();
    this.bricks = this.bricks.filter((b) => b.uid !== this.selectedBrickUid);
    this.selectedBrickUid = null;
    this.snapBracketGroup.visible = false;
    this.rebuildAllMeshes();
    sound.playBrickRemove();
    this.onChange();
  }

  /**
   * Moves either the active ghost preview (in Build mode) OR the selected placed brick
   * (in Move mode) along screen-relative horizontal axes (left/right/forward/back)
   * or vertically by 1 plate! Pressing ► ALWAYS moves right on your screen.
   */
  public nudge(screenRight: number, screenForward: number, dyPlates: number): void {
    if (!this.active) return;

    // Derive camera-aligned horizontal stud axes so controls match screen perspective!
    const camDir = new THREE.Vector3();
    this.engine.camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 0.001) camDir.set(0, 0, -1);
    camDir.normalize();

    let fwdX = 0, fwdZ = 0;
    if (Math.abs(camDir.x) >= Math.abs(camDir.z)) {
      fwdX = Math.sign(camDir.x);
    } else {
      fwdZ = Math.sign(camDir.z);
    }
    // Right vector in Three.js XZ plane: forward × up = (-fwdZ, 0, fwdX)
    const rightX = -fwdZ;
    const rightZ = fwdX;

    const dgx = screenRight * rightX + screenForward * fwdX;
    const dgz = screenRight * rightZ + screenForward * fwdZ;

    if (this.activeTool === 'place') {
      if (!this.lastCandidate) {
        this.showAutoPreview();
      }
      if (!this.lastCandidate) return;
      const part = PARTS_MAP[this.activePartId];
      const dims = getRotatedDims(part, this.activeRot);
      const nx = THREE.MathUtils.clamp(this.lastCandidate.gx + dgx, -8, 8 - dims.w);
      const ny = THREE.MathUtils.clamp(this.lastCandidate.gy + dyPlates, -2, 18 - dims.h);
      const nz = THREE.MathUtils.clamp(this.lastCandidate.gz + dgz, -10, 12 - dims.d);
      const valid = this.isPlacementValid(this.activePartId, nx, ny, nz, this.activeRot);
      this.applyCandidatePreview(nx, ny, nz, valid);
      sound.playUiTick();
      if (navigator.vibrate) navigator.vibrate(8);
      return;
    }

    if (this.activeTool === 'move') {
      const idx = this.bricks.findIndex((b) => b.uid === this.selectedBrickUid);
      if (idx < 0) return;
      const cur = this.bricks[idx];
      const nx = cur.gx + dgx;
      const ny = cur.gy + dyPlates;
      const nz = cur.gz + dgz;

      if (this.isPlacementValid(cur.partId, nx, ny, nz, cur.rot, cur.uid)) {
        this.pushUndo();
        this.bricks[idx] = { ...cur, gx: nx, gy: ny, gz: nz };
        this.rebuildAllMeshes();
        this.refreshSelectionVisual();
        sound.playBrickSnap();
        if (navigator.vibrate) navigator.vibrate(10);
        this.onChange();
      } else {
        // Subtle bump feedback if blocked by another brick
        sound.playUiTick();
      }
    }
  }

  public toggleMirror(): boolean {
    this.mirrorX = !this.mirrorX;
    sound.playUiTick();
    this.onChange();
    return this.mirrorX;
  }

  /**
   * Automatically snaps the glowing green ghost brick to an open stud spot on top of
   * the vehicle so mobile/touch users immediately see the selected brick and where it fits!
   */
  public showAutoPreview(): void {
    if (!this.active || this.activeTool !== 'place' || !this.ghostGroup) return;
    const part = PARTS_MAP[this.activePartId];
    const dims = getRotatedDims(part, this.activeRot);

    const trySpots: [number, number, number][] = [];
    if (part.isWheel) {
      trySpots.push([-4, -1, 1], [2, -1, 1], [-4, -1, 5], [2, -1, 5], [-4, -1, -3], [2, -1, -3]);
    } else if (part.isThruster) {
      trySpots.push([-1, 2, -6], [-2, 2, -6], [0, 2, -6], [-1, 4, -5]);
    } else {
      const startGx = -Math.floor(dims.w / 2);
      const zSearch = [3, 1, 5, -1, -3, 0, 2, 4, -2];
      for (const gz of zSearch) {
        for (let gy = 1; gy <= 12; gy++) {
          trySpots.push([startGx, gy, gz]);
        }
      }
    }

    for (const [gx, gy, gz] of trySpots) {
      if (this.isPlacementValid(this.activePartId, gx, gy, gz, this.activeRot)) {
        this.applyCandidatePreview(gx, gy, gz, true);
        return;
      }
    }
  }

  private applyCandidatePreview(gx: number, gy: number, gz: number, valid: boolean): void {
    if (!this.ghostGroup) return;
    const part = PARTS_MAP[this.activePartId];
    const dims = getRotatedDims(part, this.activeRot);
    this.lastCandidate = { gx, gy, gz, valid };

    const cx = (gx + dims.w / 2) * STUD_SIZE;
    const cy = (gy + dims.h / 2) * PLATE_HEIGHT;
    const cz = (gz + dims.d / 2) * STUD_SIZE;

    this.ghostGroup.position.set(cx, cy, cz);
    this.ghostGroup.visible = true;

    this.snapBracketGroup.position.set(cx, cy, cz);
    this.snapBracketGroup.visible = true;
    this.setBracketsValid(valid);
  }

  /** Snaps the currently previewed ghost brick directly onto the car (1-tap friendly on mobile!) */
  public placeCurrentPreview(): boolean {
    if (this.activeTool !== 'place') return false;
    if (!this.lastCandidate || !this.lastCandidate.valid) {
      this.showAutoPreview();
    }
    if (!this.lastCandidate || !this.lastCandidate.valid) return false;
    const prev = { ...this.lastCandidate };
    this.commitCandidate(prev);
    // Advance preview 1 layer upward so rapid stacking is effortless, or fallback to auto spot
    const part = PARTS_MAP[this.activePartId];
    const nextGy = prev.gy + part.h;
    if (this.isPlacementValid(this.activePartId, prev.gx, nextGy, prev.gz, this.activeRot)) {
      this.applyCandidatePreview(prev.gx, nextGy, prev.gz, true);
    } else {
      this.showAutoPreview();
    }
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.bricks.map((b) => ({ ...b })));
    this.bricks = this.undoStack.pop()!;
    this.rebuildAllMeshes();
    sound.playBrickRemove();
    this.onChange();
  }

  public redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.bricks.map((b) => ({ ...b })));
    this.bricks = this.redoStack.pop()!;
    this.rebuildAllMeshes();
    sound.playBrickSnap();
    this.onChange();
  }

  public clearToChassis(): void {
    this.pushUndo();
    this.bricks = [
      { uid: makeUid('ch'), partId: 'plate_4x6', gx: -2, gy: 0, gz: -3, rot: 0, color: '#1d2128' },
      { uid: makeUid('ch'), partId: 'plate_4x6', gx: -2, gy: 0, gz: 3, rot: 0, color: '#1d2128' },
      { uid: makeUid('ch'), partId: 'wheel_offroad', gx: -4, gy: -1, gz: 5, rot: 0, color: '#aeb6c2' },
      { uid: makeUid('ch'), partId: 'wheel_offroad', gx: 2, gy: -1, gz: 5, rot: 0, color: '#aeb6c2' },
      { uid: makeUid('ch'), partId: 'wheel_offroad', gx: -4, gy: -1, gz: -2, rot: 0, color: '#aeb6c2' },
      { uid: makeUid('ch'), partId: 'wheel_offroad', gx: 2, gy: -1, gz: -2, rot: 0, color: '#aeb6c2' },
    ];
    this.rebuildAllMeshes();
    sound.playBrickRemove();
    this.onChange();
  }

  private pushUndo(): void {
    this.undoStack.push(this.bricks.map((b) => ({ ...b })));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  private rebuildAllMeshes(): void {
    while (this.vehicleGroup.children.length > 0) {
      this.vehicleGroup.remove(this.vehicleGroup.children[0]);
    }
    this.brickMeshes.clear();
    this.occupied.clear();

    for (const brick of this.bricks) {
      this.addBrickVisual(brick, false);
    }
  }

  private addBrickVisual(brick: PlacedBrick, animatePop: boolean): void {
    const mesh = createBrickMesh(brick.partId, brick.color);
    const center = getBrickCenterWorld(brick);
    mesh.position.set(center.x, center.y, center.z);
    mesh.rotation.y = (brick.rot * Math.PI) / 2;
    mesh.userData.brickUid = brick.uid;
    mesh.traverse((child) => {
      child.userData.brickUid = brick.uid;
    });

    this.vehicleGroup.add(mesh);
    this.brickMeshes.set(brick.uid, mesh);

    for (const key of getOccupiedKeys(brick)) {
      this.occupied.set(key, brick.uid);
    }

    if (animatePop) {
      mesh.scale.set(0.72, 0.72, 0.72);
      this.popAnimations.push({ group: mesh, t: 0 });
    }
  }

  private rebuildGhostMesh(): void {
    if (!this.active) return;
    if (this.ghostGroup) {
      this.engine.scene.remove(this.ghostGroup);
    }
    const ghost = createBrickMesh(this.activePartId, this.activeColor);
    ghost.rotation.y = (this.activeRot * Math.PI) / 2;
    ghost.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.castShadow = false;
        m.receiveShadow = false;
        const orig = m.material as THREE.MeshStandardMaterial;
        const clone = orig.clone();
        clone.transparent = true;
        clone.opacity = 0.52;
        clone.depthWrite = false;
        m.material = clone;
      }
    });
    ghost.visible = false;
    this.ghostGroup = ghost;
    this.engine.scene.add(ghost);
    this.rebuildSnapBrackets();
  }

  /**
   * Iconic green 3D corner snap-target brackets (matching Screenshot 1!)
   */
  private rebuildSnapBrackets(): void {
    const part = PARTS_MAP[this.activePartId];
    const dims = getRotatedDims(part, this.activeRot);
    this.rebuildSnapBracketsForDims(dims, this.bracketMatValid);
  }

  private rebuildSnapBracketsForDims(dims: { w: number; h: number; d: number }, mat: THREE.Material): void {
    while (this.snapBracketGroup.children.length > 0) {
      this.snapBracketGroup.remove(this.snapBracketGroup.children[0]);
    }
    const W = dims.w * STUD_SIZE + 0.16;
    const H = dims.h * PLATE_HEIGHT + 0.14;
    const D = dims.d * STUD_SIZE + 0.16;
    const cornerLen = Math.min(0.44, W * 0.34, D * 0.34);
    const thick = 0.06;

    const signs = [-1, 1];
    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          const cx = sx * (W / 2);
          const cy = sy * (H / 2);
          const cz = sz * (D / 2);

          const barX = new THREE.Mesh(new THREE.BoxGeometry(cornerLen, thick, thick), mat);
          barX.position.set(cx - sx * (cornerLen / 2), cy, cz);
          const barY = new THREE.Mesh(new THREE.BoxGeometry(thick, Math.min(cornerLen, H * 0.45), thick), mat);
          barY.position.set(cx, cy - sy * (Math.min(cornerLen, H * 0.45) / 2), cz);
          const barZ = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, cornerLen), mat);
          barZ.position.set(cx, cy, cz - sz * (cornerLen / 2));

          this.snapBracketGroup.add(barX, barY, barZ);
        }
      }
    }
  }

  private setBracketsValid(valid: boolean): void {
    const mat = valid ? this.bracketMatValid : this.bracketMatInvalid;
    this.snapBracketGroup.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        (obj as THREE.Mesh).material = mat;
      }
    });
  }

  private clearHoverHighlight(): void {
    if (this.hoverHighlight) {
      this.engine.scene.remove(this.hoverHighlight);
      this.hoverHighlight.geometry.dispose();
      this.hoverHighlight = null;
    }
    this.hoveredBrickUid = null;
  }

  private showBrickHighlight(brick: PlacedBrick, color: number): void {
    this.clearHoverHighlight();
    const part = PARTS_MAP[brick.partId];
    const dims = getRotatedDims(part, brick.rot);
    const center = getBrickCenterWorld(brick);
    const box = new THREE.BoxGeometry(
      dims.w * STUD_SIZE + 0.08,
      dims.h * PLATE_HEIGHT + 0.08,
      dims.d * STUD_SIZE + 0.08
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color }));
    lines.position.set(center.x, center.y, center.z);
    this.hoverHighlight = lines;
    this.hoveredBrickUid = brick.uid;
    this.engine.scene.add(lines);
  }

  private isPlacementValid(
    partId: BrickPartId,
    gx: number,
    gy: number,
    gz: number,
    rot: 0 | 1 | 2 | 3,
    ignoreUid?: string
  ): boolean {
    if (!ignoreUid && this.bricks.length >= MAX_BRICKS) return false;
    const part = PARTS_MAP[partId];
    const dims = getRotatedDims(part, rot);
    // Keep within reasonable build volume
    if (gx < -8 || gx + dims.w > 8 || gz < -10 || gz + dims.d > 12 || gy < -2 || gy + dims.h > 18) {
      return false;
    }
    for (let x = 0; x < dims.w; x++) {
      for (let y = 0; y < dims.h; y++) {
        for (let z = 0; z < dims.d; z++) {
          const occ = this.occupied.get(`${gx + x},${gy + y},${gz + z}`);
          if (occ && occ !== ignoreUid) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private computeSnapFromPointer(clientX: number, clientY: number): void {
    const rect = this.engine.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.engine.camera);

    const brickHits = this.raycaster.intersectObjects(this.vehicleGroup.children, true);

    if (this.activeTool === 'erase' || this.activeTool === 'paint' || this.activeTool === 'move') {
      if (this.ghostGroup) this.ghostGroup.visible = false;
      if (this.activeTool !== 'move') {
        this.snapBracketGroup.visible = false;
      }
      this.lastCandidate = null;
      if (brickHits.length > 0) {
        const uid = brickHits[0].object.userData.brickUid as string | undefined;
        const brick = this.bricks.find((b) => b.uid === uid);
        if (brick) {
          const highlightColor =
            this.activeTool === 'erase' ? 0xff3b3b : this.activeTool === 'move' ? 0x38e8ff : 0xf4be17;
          this.showBrickHighlight(brick, highlightColor);
          return;
        }
      }
      this.clearHoverHighlight();
      return;
    }

    // Place mode
    this.clearHoverHighlight();
    const part = PARTS_MAP[this.activePartId];
    const dims = getRotatedDims(part, this.activeRot);

    let gx = 0;
    let gy = 0;
    let gz = 0;
    let found = false;

    const firstHit = brickHits[0];
    if (firstHit && firstHit.face) {
      const hit = firstHit;
      const worldNormal = firstHit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      const targetPt = hit.point.clone().addScaledVector(worldNormal, 0.06);

      // Snap axis based on dominant normal direction
      const absX = Math.abs(worldNormal.x);
      const absY = Math.abs(worldNormal.y);
      const absZ = Math.abs(worldNormal.z);

      const cellX = Math.floor(targetPt.x / STUD_SIZE);
      const cellY = Math.floor(targetPt.y / PLATE_HEIGHT);
      const cellZ = Math.floor(targetPt.z / STUD_SIZE);

      if (absY >= absX && absY >= absZ) {
        gx = Math.round(targetPt.x / STUD_SIZE - dims.w / 2);
        gz = Math.round(targetPt.z / STUD_SIZE - dims.d / 2);
        gy = worldNormal.y > 0 ? Math.max(0, Math.round(hit.point.y / PLATE_HEIGHT)) : cellY - dims.h + 1;
      } else if (absX >= absY && absX >= absZ) {
        gx = worldNormal.x > 0 ? cellX : cellX - dims.w + 1;
        gy = Math.max(part.isWheel ? -1 : 0, Math.round(hit.point.y / PLATE_HEIGHT - dims.h / 2));
        gz = Math.round(targetPt.z / STUD_SIZE - dims.d / 2);
      } else {
        gz = worldNormal.z > 0 ? cellZ : cellZ - dims.d + 1;
        gy = Math.max(part.isWheel ? -1 : 0, Math.round(hit.point.y / PLATE_HEIGHT - dims.h / 2));
        gx = Math.round(targetPt.x / STUD_SIZE - dims.w / 2);
      }
      found = true;
    } else {
      const planeHits = this.raycaster.intersectObject(this.buildPlane);
      if (planeHits.length > 0) {
        const pt = planeHits[0].point;
        gx = Math.round(pt.x / STUD_SIZE - dims.w / 2);
        gz = Math.round(pt.z / STUD_SIZE - dims.d / 2);
        gy = part.isWheel ? -1 : 0;
        found = true;
      }
    }

    if (!found || !this.ghostGroup) {
      if (this.ghostGroup) this.ghostGroup.visible = false;
      this.snapBracketGroup.visible = false;
      this.lastCandidate = null;
      return;
    }

    const valid = this.isPlacementValid(this.activePartId, gx, gy, gz, this.activeRot);
    this.lastCandidate = { gx, gy, gz, valid };

    const cx = (gx + dims.w / 2) * STUD_SIZE;
    const cy = (gy + dims.h / 2) * PLATE_HEIGHT;
    const cz = (gz + dims.d / 2) * STUD_SIZE;

    this.ghostGroup.position.set(cx, cy, cz);
    this.ghostGroup.visible = true;

    this.snapBracketGroup.position.set(cx, cy, cz);
    this.snapBracketGroup.visible = true;
    this.setBracketsValid(valid);
  }

  private performClickAction(clientX: number, clientY: number, isRightClick = false): void {
    this.computeSnapFromPointer(clientX, clientY);

    if (isRightClick || this.activeTool === 'erase') {
      // Raycast directly for brick removal
      const rect = this.engine.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, this.engine.camera);
      const hits = this.raycaster.intersectObjects(this.vehicleGroup.children, true);
      if (hits.length > 0) {
        const uid = hits[0].object.userData.brickUid as string | undefined;
        if (uid && this.bricks.length > 1) {
          this.pushUndo();
          this.bricks = this.bricks.filter((b) => b.uid !== uid);
          this.rebuildAllMeshes();
          this.clearHoverHighlight();
          sound.playBrickRemove();
          this.onChange();
        }
      }
      return;
    }

    if (this.activeTool === 'move') {
      if (this.hoveredBrickUid) {
        this.selectBrick(this.hoveredBrickUid, true);
        sound.playUiTick();
        if (navigator.vibrate) navigator.vibrate(10);
        return;
      }
      // If tapping open floor while a brick is selected, relocate it straight there!
      const selIdx = this.bricks.findIndex((b) => b.uid === this.selectedBrickUid);
      if (selIdx >= 0) {
        const cur = this.bricks[selIdx];
        const part = PARTS_MAP[cur.partId];
        const dims = getRotatedDims(part, cur.rot);
        const planeHits = this.raycaster.intersectObject(this.buildPlane);
        if (planeHits.length > 0) {
          const pt = planeHits[0].point;
          const nx = Math.round(pt.x / STUD_SIZE - dims.w / 2);
          const nz = Math.round(pt.z / STUD_SIZE - dims.d / 2);
          if (this.isPlacementValid(cur.partId, nx, cur.gy, nz, cur.rot, cur.uid)) {
            this.pushUndo();
            this.bricks[selIdx] = { ...cur, gx: nx, gz: nz };
            this.rebuildAllMeshes();
            this.refreshSelectionVisual();
            sound.playBrickSnap();
            this.onChange();
          }
        }
      }
      return;
    }

    if (this.activeTool === 'paint') {
      if (this.hoveredBrickUid) {
        const idx = this.bricks.findIndex((b) => b.uid === this.hoveredBrickUid);
        if (idx >= 0 && this.bricks[idx].color !== this.activeColor) {
          this.pushUndo();
          this.bricks[idx] = { ...this.bricks[idx], color: this.activeColor };
          this.rebuildAllMeshes();
          sound.playBrickSnap();
          this.onChange();
        }
      }
      return;
    }

    // Place tool
    if (this.lastCandidate && this.lastCandidate.valid) {
      this.commitCandidate(this.lastCandidate);
      // Re-evaluate snap immediately so user can stack bricks effortlessly
      this.computeSnapFromPointer(clientX, clientY);
    }
  }

  private commitCandidate(candidate: SnapCandidate): void {
    this.pushUndo();
    const { gx, gy, gz } = candidate;
    const placed: PlacedBrick = {
      uid: makeUid('u'),
      partId: this.activePartId,
      gx,
      gy,
      gz,
      rot: this.activeRot,
      color: this.activeColor,
    };
    this.bricks.push(placed);
    this.lastPlacedUid = placed.uid;
    this.addBrickVisual(placed, true);

    // Optional X-axis symmetry mirror placement!
    if (this.mirrorX) {
      const part = PARTS_MAP[this.activePartId];
      const dims = getRotatedDims(part, this.activeRot);
      const mirrorGx = -(gx + dims.w);
      if (mirrorGx !== gx && this.isPlacementValid(this.activePartId, mirrorGx, gy, gz, this.activeRot)) {
        const mirrorBrick: PlacedBrick = {
          uid: makeUid('m'),
          partId: this.activePartId,
          gx: mirrorGx,
          gy,
          gz,
          rot: this.activeRot,
          color: this.activeColor,
        };
        this.bricks.push(mirrorBrick);
        this.addBrickVisual(mirrorBrick, true);
      }
    }

    this.placedCountSession++;
    sound.playBrickSnap();
    if (navigator.vibrate) navigator.vibrate(14);
    this.onChange();
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active) return;
    if (e.pointerType === 'mouse' && !this.isPointerDown) {
      this.computeSnapFromPointer(e.clientX, e.clientY);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.active) return;
    if (this.controls) this.controls.autoRotate = false;
    this.isPointerDown = true;
    this.pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.active || !this.isPointerDown) return;
    this.isPointerDown = false;
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    const dt = performance.now() - this.pointerDownPos.time;
    const dist = Math.hypot(dx, dy);

    // Quick tap or click without dragging -> place / move / paint / erase!
    if (dist < 12 && dt < 420) {
      this.performClickAction(e.clientX, e.clientY, e.button === 2);
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (!this.active) return;
    e.preventDefault();
  };

  private onResize = (): void => {
    if (!this.active) return;
    this.recenterCamera();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'r' || e.key === 'R') {
      this.rotatePart();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    } else if (e.key === '1') {
      this.setTool('place');
    } else if (e.key === '2') {
      this.setTool('move');
    } else if (e.key === '3') {
      this.setTool('paint');
    } else if (e.key === '4') {
      this.setTool('erase');
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.activeTool === 'move' && this.selectedBrickUid) {
        this.deleteSelected();
      } else {
        this.setTool('erase');
      }
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMirror();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.nudge(-1, 0, 0);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.nudge(1, 0, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.nudge(0, 1, 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.nudge(0, -1, 0);
    } else if (e.key === 'e' || e.key === 'E' || e.key === 'PageUp') {
      e.preventDefault();
      this.nudge(0, 0, 1);
    } else if (e.key === 'q' || e.key === 'Q' || e.key === 'PageDown') {
      e.preventDefault();
      this.nudge(0, 0, -1);
    } else if (e.key === 'Enter' && this.activeTool === 'place') {
      e.preventDefault();
      this.placeCurrentPreview();
    }
  };

  private bindEvents(): void {
    const dom = this.engine.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  private unbindEvents(): void {
    const dom = this.engine.renderer.domElement;
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
  }

  public update(dt: number): void {
    if (!this.active) return;
    this.controls?.update();

    // Subtle breathing animation on the green corner snap brackets
    this.pulseTime += dt * 4.5;
    if (this.snapBracketGroup.visible) {
      const s = 1.0 + Math.sin(this.pulseTime) * 0.025;
      this.snapBracketGroup.scale.set(s, s, s);
    }

    // Spring pop animation for newly snapped bricks
    for (let i = this.popAnimations.length - 1; i >= 0; i--) {
      const anim = this.popAnimations[i];
      anim.t += dt * 7.5;
      if (anim.t >= 1) {
        anim.group.scale.set(1, 1, 1);
        this.popAnimations.splice(i, 1);
      } else {
        const ease = 1 + Math.sin(anim.t * Math.PI) * 0.14;
        const s = 0.72 + 0.28 * anim.t * ease;
        anim.group.scale.set(s, s, s);
      }
    }
  }
}
