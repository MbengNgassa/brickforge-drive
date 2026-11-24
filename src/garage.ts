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
  private hoverHighlight: THREE.LineSegments | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0, time: 0 };
  private isPointerDown = false;
  private lastCandidate: SnapCandidate | null = null;
  private hoveredBrickUid: string | null = null;

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

  private onChange: () => void;

  constructor(engine: GraphicsEngine, onChange: () => void) {
    this.engine = engine;
    this.onChange = onChange;
  }

  public enter(blueprint: VehicleBlueprint): void {
    this.active = true;
    this.engine.clearScene();
    const scene = this.engine.scene;

    // Bright clean garage studio atmosphere (inspired by Screenshot 1)
    scene.background = new THREE.Color(0x202733);
    scene.fog = new THREE.Fog(0x202733, 38, 95);

    // Studio 3-point lighting
    const hemi = new THREE.HemisphereLight(0xf8fbff, 0x3b4454, 1.05);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff9f0, 2.0);
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

    const rimLight = new THREE.DirectionalLight(0x7cc4ff, 0.75);
    rimLight.position.set(-14, 10, -14);
    scene.add(rimLight);

    // Glossy studio floor with tile texture
    const floorTex = createGarageFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(110, 110),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.34,
        metalness: 0.08,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -PLATE_HEIGHT * 1.4;
    floor.receiveShadow = true;
    scene.add(floor);

    // Turntable workshop ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(9.2, 9.65, 64),
      new THREE.MeshBasicMaterial({ color: 0xf4be17, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -PLATE_HEIGHT * 1.36;
    scene.add(ring);

    // Front-direction chevron on the floor so builders always know which way is forward (+Z)
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 1.1);
    arrowShape.lineTo(0.85, -0.4);
    arrowShape.lineTo(0.32, -0.4);
    arrowShape.lineTo(0.32, -1.0);
    arrowShape.lineTo(-0.32, -1.0);
    arrowShape.lineTo(-0.32, -0.4);
    arrowShape.lineTo(-0.85, -0.4);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(Math.PI / 2);
    const arrow = new THREE.Mesh(
      arrowGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
    );
    arrow.position.set(0, -PLATE_HEIGHT * 1.34, 8.2);
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
    const grid = new THREE.GridHelper(20 * STUD_SIZE, 20, 0x475569, 0x334155);
    grid.position.y = -PLATE_HEIGHT * 1.33;
    scene.add(grid);

    // Vehicle container & snap brackets
    this.vehicleGroup = new THREE.Group();
    scene.add(this.vehicleGroup);

    this.snapBracketGroup = new THREE.Group();
    this.snapBracketGroup.visible = false;
    scene.add(this.snapBracketGroup);

    // Setup OrbitControls
    const cam = this.engine.camera;
    cam.fov = 48;
    cam.updateProjectionMatrix();
    cam.position.set(10.5, 7.2, 11.2);
    this.controls = new OrbitControls(cam, this.engine.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.4, 1.2);
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 28;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.update();

    this.loadBricks(blueprint.bricks, false);
    this.rebuildGhostMesh();
    this.bindEvents();
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
    sound.playUiTick();
    this.onChange();
  }

  public setColor(hex: string): void {
    this.activeColor = hex;
    this.rebuildGhostMesh();
    sound.playUiTick();
    this.onChange();
  }

  public setTool(tool: BuilderTool): void {
    this.activeTool = tool;
    if (this.ghostGroup) this.ghostGroup.visible = false;
    this.snapBracketGroup.visible = false;
    this.clearHoverHighlight();
    sound.playUiTick();
    this.onChange();
  }

  public rotatePart(): void {
    this.activeRot = ((this.activeRot + 1) % 4) as 0 | 1 | 2 | 3;
    this.rebuildGhostMesh();
    sound.playUiTick();
    this.onChange();
  }

  public toggleMirror(): boolean {
    this.mirrorX = !this.mirrorX;
    sound.playUiTick();
    this.onChange();
    return this.mirrorX;
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
    while (this.snapBracketGroup.children.length > 0) {
      this.snapBracketGroup.remove(this.snapBracketGroup.children[0]);
    }
    const part = PARTS_MAP[this.activePartId];
    const dims = getRotatedDims(part, this.activeRot);
    const W = dims.w * STUD_SIZE + 0.14;
    const H = dims.h * PLATE_HEIGHT + 0.12;
    const D = dims.d * STUD_SIZE + 0.14;
    const cornerLen = Math.min(0.42, W * 0.34, D * 0.34);
    const thick = 0.055;

    const signs = [-1, 1];
    for (const sx of signs) {
      for (const sy of signs) {
        for (const sz of signs) {
          const cx = sx * (W / 2);
          const cy = sy * (H / 2);
          const cz = sz * (D / 2);

          const barX = new THREE.Mesh(new THREE.BoxGeometry(cornerLen, thick, thick), this.bracketMatValid);
          barX.position.set(cx - sx * (cornerLen / 2), cy, cz);
          const barY = new THREE.Mesh(new THREE.BoxGeometry(thick, Math.min(cornerLen, H * 0.45), thick), this.bracketMatValid);
          barY.position.set(cx, cy - sy * (Math.min(cornerLen, H * 0.45) / 2), cz);
          const barZ = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, cornerLen), this.bracketMatValid);
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

  private isPlacementValid(partId: BrickPartId, gx: number, gy: number, gz: number, rot: 0 | 1 | 2 | 3): boolean {
    if (this.bricks.length >= MAX_BRICKS) return false;
    const part = PARTS_MAP[partId];
    const dims = getRotatedDims(part, rot);
    // Keep within reasonable build volume
    if (gx < -8 || gx + dims.w > 8 || gz < -10 || gz + dims.d > 12 || gy < -2 || gy + dims.h > 18) {
      return false;
    }
    for (let x = 0; x < dims.w; x++) {
      for (let y = 0; y < dims.h; y++) {
        for (let z = 0; z < dims.d; z++) {
          if (this.occupied.has(`${gx + x},${gy + y},${gz + z}`)) {
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

    if (this.activeTool === 'erase' || this.activeTool === 'paint') {
      if (this.ghostGroup) this.ghostGroup.visible = false;
      this.snapBracketGroup.visible = false;
      this.lastCandidate = null;
      if (brickHits.length > 0) {
        const uid = brickHits[0].object.userData.brickUid as string | undefined;
        const brick = this.bricks.find((b) => b.uid === uid);
        if (brick) {
          this.showBrickHighlight(brick, this.activeTool === 'erase' ? 0xff3b3b : 0x38bdf8);
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
      this.pushUndo();
      const { gx, gy, gz } = this.lastCandidate;
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

      sound.playBrickSnap();
      if (navigator.vibrate) navigator.vibrate(12);
      this.onChange();
      // Re-evaluate snap immediately so user can stack bricks effortlessly
      this.computeSnapFromPointer(clientX, clientY);
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.active) return;
    if (e.pointerType === 'mouse' && !this.isPointerDown) {
      this.computeSnapFromPointer(e.clientX, e.clientY);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.active) return;
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

    // Quick tap or click without dragging -> place / paint / erase!
    if (dist < 8 && dt < 380) {
      this.performClickAction(e.clientX, e.clientY, e.button === 2);
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (!this.active) return;
    e.preventDefault();
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
      this.setTool('paint');
    } else if (e.key === '3' || e.key === 'Delete' || e.key === 'Backspace') {
      this.setTool('erase');
    } else if (e.key === 'm' || e.key === 'M') {
      this.toggleMirror();
    }
  };

  private bindEvents(): void {
    const dom = this.engine.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private unbindEvents(): void {
    const dom = this.engine.renderer.domElement;
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
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
