import * as THREE from 'three';
import { AI_RACER_PROFILES, STARTER_BLUEPRINTS, cloneBlueprint } from './blueprints';
import {
  createArenaFloorTexture,
  createAsphaltTexture,
  createCanyonGroundTexture,
} from './brickMesh';
import { sound } from './audio';
import { DebrisSystem, DriveVehicle } from './vehiclePhysics';
import type { ControlInput } from './vehiclePhysics';
import type { GraphicsEngine } from './engine';
import type { DriverProfile, GameMode, HudState, VehicleBlueprint } from './types';

interface RampDef {
  x: number;
  z: number;
  heading: number; // direction the ramp climbs toward (+Z local)
  width: number;
  length: number;
  height: number;
}

interface BoostPadDef {
  pos: THREE.Vector3;
  radius: number;
}

interface SpringPadDef {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  radius: number;
  power: number;
  bounceAnim: number;
}

interface StuntRingDef {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  radius: number;
  cooldown: number;
}

interface PickupDef {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  type: 'repair' | 'nitro';
  cooldown: number;
}

interface KnockableCone {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  active: boolean;
}

interface DerbyAiBrain {
  role: 'brawler' | 'flanker' | 'opportunist' | 'stunt_hunter';
  targetId: string | null;
  state: 'fight' | 'heal' | 'nitro' | 'roam' | 'recover';
  decisionTimer: number;
  stuckTimer: number;
  recoverTimer: number;
  recoverSteer: number;
  roamTarget: THREE.Vector3;
  flankSign: number;
}

export interface TouchInputState {
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
  boost: boolean;
  drift: boolean;
  jump: boolean;
}

const ARENA_RADIUS = 82;
const TOTAL_LAPS = 3;

export class GameWorldController {
  private engine: GraphicsEngine;
  private mode: Exclude<GameMode, 'garage'> = 'race';
  private active = false;
  private paused = false;

  private vehicles: DriveVehicle[] = [];
  private aiBrains = new Map<string, DerbyAiBrain>();
  private player!: DriveVehicle;
  private debris!: DebrisSystem;

  // Race track spline & metadata
  private trackCurve: THREE.CatmullRomCurve3 | null = null;
  private trackSamples: THREE.Vector3[] = [];
  private trackTangents: THREE.Vector3[] = [];
  private trackHalfWidth = 19.0;
  private waypointMesh: THREE.Object3D | null = null;
  private wrongWayTimer = 0;

  // World interactive props
  private ramps: RampDef[] = [];
  private boostPads: BoostPadDef[] = [];
  private springPads: SpringPadDef[] = [];
  private stuntRings: StuntRingDef[] = [];
  private pickups: PickupDef[] = [];
  private cones: KnockableCone[] = [];
  private pillarRadius = 6.8;

  // Input state
  private keys = new Set<string>();
  public touchInput: TouchInputState = {
    left: false,
    right: false,
    gas: false,
    brake: false,
    boost: false,
    drift: false,
    jump: false,
  };

  // Match & camera state
  private countdown = 3.2;
  private lastCountdownInt = 4;
  private elapsedTime = 0;
  private cameraMode = 0; // 0 = Chase, 1 = Wide, 2 = Hood
  private cameraShake = 0;
  private camPosCurrent = new THREE.Vector3();
  private camLookCurrent = new THREE.Vector3();
  private sunLight: THREE.DirectionalLight | null = null;

  // Scoring & HUD feedback
  private kos = 0;
  private score = 0;
  private wave = 1;
  private finished = false;
  private won = false;
  private finishMessage = '';
  private finishSubtext = '';
  private eventBanner = '';
  private eventBannerTimer = 0;
  private playerBlueprint!: VehicleBlueprint;
  private otherDrivers: DriverProfile[] = [];
  private onMatchEnd?: (kos: number, won: boolean) => void;

  // Minimap callback
  public minimapCanvas: HTMLCanvasElement | null = null;

  constructor(engine: GraphicsEngine, onMatchEnd?: (kos: number, won: boolean) => void) {
    this.engine = engine;
    this.onMatchEnd = onMatchEnd;
  }

  public enter(
    mode: Exclude<GameMode, 'garage'>,
    playerBlueprint: VehicleBlueprint,
    wave = 1,
    otherDrivers: DriverProfile[] = []
  ): void {
    this.mode = mode;
    this.active = true;
    this.paused = false;
    this.wave = wave;
    this.playerBlueprint = cloneBlueprint(playerBlueprint);
    this.otherDrivers = otherDrivers;

    this.vehicles = [];
    this.aiBrains.clear();
    this.ramps = [];
    this.boostPads = [];
    this.springPads = [];
    this.stuntRings = [];
    this.pickups = [];
    this.cones = [];
    this.trackCurve = null;
    this.trackSamples = [];
    this.trackTangents = [];
    this.waypointMesh = null;
    this.wrongWayTimer = 0;

    this.countdown = mode === 'freeroam' ? -1 : 3.2;
    this.lastCountdownInt = 4;
    this.elapsedTime = 0;
    this.cameraShake = 0;
    this.kos = wave > 1 ? this.kos : 0;
    this.score = wave > 1 ? this.score : 0;
    this.finished = false;
    this.won = false;
    this.finishMessage = '';
    this.finishSubtext = '';
    this.eventBanner =
      mode === 'family'
        ? '⚔️ FAMILY CLASH — BATTLE EACH OTHER\'S BUILDS!'
        : mode === 'derby'
          ? `WAVE ${wave} — SMASH ALL RIVALS!`
          : mode === 'freeroam'
            ? 'MEGA STUNT PARK — HIT SPRINGS & SKY RINGS!'
            : '';
    this.eventBannerTimer = 2.8;

    this.engine.setBloomEnabled(true);
    this.engine.clearScene();
    const scene = this.engine.scene;
    const maxDebris = this.engine.getQuality() === 'ultra' ? 280 : this.engine.getQuality() === 'high' ? 180 : 100;
    this.debris = new DebrisSystem(scene, maxDebris);

    this.setupLighting(scene);

    if (mode === 'race') {
      this.buildCanyonRaceWorld(scene);
      this.spawnRaceVehicles(scene);
    } else {
      this.buildDerbyArenaWorld(scene, mode === 'freeroam');
      this.spawnArenaVehicles(scene, mode === 'freeroam');
    }

    // Initialize camera cleanly behind player using exact vehicle bounds
    this.updateCamera(0.016, true);

    this.bindEvents();
    sound.startDrivingAudio();
  }

  public exit(): void {
    this.active = false;
    this.unbindEvents();
    this.keys.clear();
    sound.stopDrivingAudio();
  }

  public setPaused(p: boolean): void {
    this.paused = p;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public cycleCamera(): void {
    this.cameraMode = (this.cameraMode + 1) % 3;
    if (this.player) {
      this.updateCamera(0.016, true);
    }
    sound.playUiTick();
  }

  public resetPlayerPosition(): void {
    if (!this.player || this.player.wrecked) return;
    if (this.mode === 'race' && this.trackCurve) {
      const pt = this.trackCurve.getPointAt(this.player.splineT % 1);
      const tan = this.trackCurve.getTangentAt(this.player.splineT % 1);
      this.player.position.set(pt.x, 1.2, pt.z);
      this.player.heading = Math.atan2(tan.x, tan.z);
      this.player.velocity.set(0, 0, 0);
      this.player.vy = 0;
    } else {
      this.player.position.set(0, 1.2, -48);
      this.player.heading = 0;
      this.player.velocity.set(0, 0, 0);
      this.player.vy = 0;
    }
    this.player.syncTransform();
    this.updateCamera(0.016, true);
    sound.playUiTick();
  }

  private setupLighting(scene: THREE.Scene): void {
    const isRace = this.mode === 'race';
    const skyColor = isRace ? 0x62a8e5 : 0x263244;
    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(skyColor, isRace ? 190 : 160, isRace ? 580 : 420);

    const hemi = new THREE.HemisphereLight(isRace ? 0xe0f2fe : 0xdbeafe, isRace ? 0xc26d42 : 0x374151, isRace ? 0.95 : 0.9);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(isRace ? 0xfff3dc : 0xf8fafc, isRace ? 2.2 : 1.9);
    sun.position.set(45, 70, 35);
    sun.castShadow = true;
    const sm = this.engine.getShadowMapSize();
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 220;
    const d = 58;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    scene.add(sun.target);
    this.sunLight = sun;
  }

  // =========================================================================
  // RED ROCK CANYON CIRCUIT RACE (Wide Grand Prix circuit for big brick rigs!)
  // =========================================================================
  private buildCanyonRaceWorld(scene: THREE.Scene): void {
    // Expansive desert canyon ground
    const groundTex = createCanyonGroundTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1500, 1500),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    scene.add(ground);

    // Sweeping closed canyon racing circuit (1.42x grand-prix scale!)
    const S = 1.42;
    const controlPts = [
      new THREE.Vector3(0 * S, 0, -40 * S),
      new THREE.Vector3(0 * S, 0, 90 * S),
      new THREE.Vector3(55 * S, 0, 175 * S),
      new THREE.Vector3(165 * S, 0, 175 * S),
      new THREE.Vector3(230 * S, 0, 95 * S),
      new THREE.Vector3(185 * S, 0, 5 * S),
      new THREE.Vector3(245 * S, 0, -95 * S),
      new THREE.Vector3(175 * S, 0, -180 * S),
      new THREE.Vector3(60 * S, 0, -165 * S),
      new THREE.Vector3(5 * S, 0, -115 * S),
    ];
    this.trackCurve = new THREE.CatmullRomCurve3(controlPts, true, 'catmullrom', 0.5);

    const SEGMENTS = 340;
    this.trackSamples = [];
    this.trackTangents = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const t = i / SEGMENTS;
      this.trackSamples.push(this.trackCurve.getPointAt(t));
      this.trackTangents.push(this.trackCurve.getTangentAt(t).normalize());
    }

    // Build custom UV-mapped ribbon mesh for the dark asphalt + yellow dashes + red/white kerbs!
    const roadWidth = this.trackHalfWidth * 2;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= SEGMENTS; i++) {
      const idx = i % SEGMENTS;
      const pt = this.trackSamples[idx];
      const tan = this.trackTangents[idx];
      const side = new THREE.Vector3(-tan.z, 0, tan.x).multiplyScalar(roadWidth / 2);

      positions.push(pt.x - side.x, 0.06, pt.z - side.z);
      positions.push(pt.x + side.x, 0.06, pt.z + side.z);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, i * 0.48, 1, i * 0.48);

      if (i < SEGMENTS) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        // Upward-facing (+Y) winding so the asphalt road renders crystal-clear from above!
        indices.push(a, b, c, b, d, c);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roadGeo.setIndex(indices);

    const asphaltTex = createAsphaltTexture();
    const roadMesh = new THREE.Mesh(
      roadGeo,
      new THREE.MeshStandardMaterial({
        map: asphaltTex,
        roughness: 0.7,
        metalness: 0.08,
        side: THREE.DoubleSide,
      })
    );
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // Continuous Red & White Brick Guardrails along BOTH edges (fast 2-draw-call InstancedMesh!)
    const BARRIER_SEGMENTS = 240;
    const barrierGeo = new THREE.BoxGeometry(1.5, 1.55, 8.2);
    const barrierRedMat = new THREE.MeshStandardMaterial({ color: 0xd92626, roughness: 0.42 });
    const barrierWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42 });
    const redInst = new THREE.InstancedMesh(barrierGeo, barrierRedMat, BARRIER_SEGMENTS);
    const whiteInst = new THREE.InstancedMesh(barrierGeo, barrierWhiteMat, BARRIER_SEGMENTS);
    redInst.castShadow = true;
    redInst.receiveShadow = true;
    whiteInst.castShadow = true;
    whiteInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let rIdx = 0;
    let wIdx = 0;
    const railOffset = this.trackHalfWidth + 1.4;

    for (let i = 0; i < BARRIER_SEGMENTS; i++) {
      const t = i / BARRIER_SEGMENTS;
      const pt = this.trackCurve.getPointAt(t);
      const tan = this.trackCurve.getTangentAt(t).normalize();
      const sideX = -tan.z;
      const sideZ = tan.x;
      const heading = Math.atan2(tan.x, tan.z);

      for (const sign of [-1, 1]) {
        dummy.position.set(pt.x + sideX * railOffset * sign, 0.77, pt.z + sideZ * railOffset * sign);
        dummy.rotation.set(0, heading, 0);
        dummy.updateMatrix();
        if ((i + (sign > 0 ? 1 : 0)) % 2 === 0 && rIdx < BARRIER_SEGMENTS) {
          redInst.setMatrixAt(rIdx++, dummy.matrix);
        } else if (wIdx < BARRIER_SEGMENTS) {
          whiteInst.setMatrixAt(wIdx++, dummy.matrix);
        }
      }
    }
    redInst.count = rIdx;
    whiteInst.count = wIdx;
    redInst.instanceMatrix.needsUpdate = true;
    whiteInst.instanceMatrix.needsUpdate = true;
    scene.add(redInst, whiteInst);

    // Bright Yellow-and-Black Corner Chevron Boards on every curve!
    const chevronCanvas = document.createElement('canvas');
    chevronCanvas.width = 256;
    chevronCanvas.height = 128;
    const cctx = chevronCanvas.getContext('2d')!;
    cctx.fillStyle = '#facc15';
    cctx.fillRect(0, 0, 256, 128);
    cctx.strokeStyle = '#111827';
    cctx.lineWidth = 22;
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    for (const ox of [52, 130, 208]) {
      cctx.beginPath();
      cctx.moveTo(ox - 28, 22);
      cctx.lineTo(ox + 14, 64);
      cctx.lineTo(ox - 28, 106);
      cctx.stroke();
    }
    const chevronTex = new THREE.CanvasTexture(chevronCanvas);
    chevronTex.colorSpace = THREE.SRGBColorSpace;
    const chevronMat = new THREE.MeshBasicMaterial({ map: chevronTex, side: THREE.DoubleSide });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });

    for (let i = 0; i < SEGMENTS; i += 10) {
      const prevT = this.trackTangents[(i - 5 + SEGMENTS) % SEGMENTS];
      const nextT = this.trackTangents[(i + 5) % SEGMENTS];
      const turn = prevT.x * nextT.z - prevT.z * nextT.x;
      if (Math.abs(turn) > 0.14) {
        const pt = this.trackSamples[i];
        const tan = this.trackTangents[i];
        const outerSign = turn > 0 ? 1 : -1;
        const distOut = this.trackHalfWidth + 3.6;
        const board = new THREE.Group();
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 4.0, 0.45), postMat);
        post.position.y = 2.0;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 2.8), chevronMat);
        sign.position.y = 3.8;
        board.add(post, sign);
        board.position.set(pt.x + -tan.z * distOut * outerSign, 0, pt.z + tan.x * distOut * outerSign);
        board.rotation.y = Math.atan2(tan.x, tan.z) + (outerSign > 0 ? Math.PI * 0.65 : -Math.PI * 0.65);
        scene.add(board);
      }
    }

    // Glowing cyan road-surface direction chevrons so forward track flow is unmistakable!
    const roadArrowMat = new THREE.MeshBasicMaterial({
      color: 0x38e8ff,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 2.8);
    arrowShape.lineTo(2.8, -0.7);
    arrowShape.lineTo(1.4, -0.7);
    arrowShape.lineTo(0, 1.0);
    arrowShape.lineTo(-1.4, -0.7);
    arrowShape.lineTo(-2.8, -0.7);
    arrowShape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(Math.PI / 2);

    for (let i = 6; i < SEGMENTS; i += 20) {
      const pt = this.trackSamples[i];
      const tan = this.trackTangents[i];
      const arrow = new THREE.Mesh(arrowGeo, roadArrowMat);
      arrow.position.set(pt.x, 0.12, pt.z);
      arrow.rotation.y = Math.atan2(tan.x, tan.z);
      scene.add(arrow);
    }

    // Start / Finish Brick Gantry + DYNAMO Overhead Arch
    this.buildTrackGantry(scene, 0.015, 'BRICK GP', 0xd92626);
    this.buildTrackGantry(scene, 0.28, 'DYNAMO', 0xee6a18);
    this.buildTrackGantry(scene, 0.62, 'NITRO ZONE', 0x0284c7);

    // Glowing cyan Boost Pads along track
    const padTs = [0.12, 0.36, 0.56, 0.82];
    for (const t of padTs) {
      const pt = this.trackCurve.getPointAt(t);
      const tan = this.trackCurve.getTangentAt(t);
      this.createBoostPad(scene, pt, Math.atan2(tan.x, tan.z));
    }

    // Launch Jump Ramps on straightaways
    const rampTs = [0.22, 0.72];
    for (const t of rampTs) {
      const pt = this.trackCurve.getPointAt(t);
      const tan = this.trackCurve.getTangentAt(t);
      this.createRamp(scene, pt.x, pt.z, Math.atan2(tan.x, tan.z), 12.5, 14.0, 3.2);
    }

    // Brick-built Red Rock Canyon Mesas & Buttes framing the circuit!
    const mesaMat1 = new THREE.MeshStandardMaterial({ color: 0xb84a27, roughness: 0.85 });
    const mesaMat2 = new THREE.MeshStandardMaterial({ color: 0xd46a38, roughness: 0.85 });
    const mesaMat3 = new THREE.MeshStandardMaterial({ color: 0x91351b, roughness: 0.88 });
    const mats = [mesaMat1, mesaMat2, mesaMat3];

    const mesaSpecs = [
      { x: -72 * S, z: 65 * S, w: 42, h: 44, d: 38 },
      { x: -66 * S, z: -60 * S, w: 38, h: 34, d: 42 },
      { x: 112 * S, z: 75 * S, w: 40, h: 48, d: 34 },
      { x: 108 * S, z: -55 * S, w: 44, h: 42, d: 40 },
      { x: 295 * S, z: 160 * S, w: 52, h: 58, d: 50 },
      { x: 318 * S, z: -25 * S, w: 48, h: 52, d: 54 },
      { x: 278 * S, z: -232 * S, w: 54, h: 46, d: 44 },
      { x: -12 * S, z: 232 * S, w: 56, h: 54, d: 44 },
      { x: 125 * S, z: 252 * S, w: 50, h: 42, d: 40 },
      { x: 65 * S, z: -248 * S, w: 52, h: 50, d: 42 },
    ];

    for (const m of mesaSpecs) {
      const mesa = new THREE.Group();
      for (let tier = 0; tier < 3; tier++) {
        const scale = 1 - tier * 0.24;
        const tierH = m.h / 3;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(m.w * scale, tierH, m.d * scale),
          mats[tier % mats.length]
        );
        box.position.y = tier * tierH + tierH / 2;
        box.castShadow = true;
        box.receiveShadow = true;
        mesa.add(box);
      }
      mesa.position.set(m.x, 0, m.z);
      scene.add(mesa);
    }

    // Brick-built desert cacti outside the guardrails
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x2d8a47, roughness: 0.6 });
    for (let i = 0; i < 36; i++) {
      const t = i / 36;
      const pt = this.trackCurve.getPointAt(t);
      const tan = this.trackCurve.getTangentAt(t);
      const sideSign = i % 2 === 0 ? 1 : -1;
      const offset = (this.trackHalfWidth + 7.5 + (i % 3) * 4) * sideSign;
      const cx = pt.x + -tan.z * offset;
      const cz = pt.z + tan.x * offset;
      const cactus = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.4, 1.1), cactusMat);
      trunk.position.y = 2.2;
      trunk.castShadow = true;
      const armL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.85, 0.85), cactusMat);
      armL.position.set(-1.1, 2.6, 0);
      const armR = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.8, 0.85), cactusMat);
      armR.position.set(1.2, 3.0, 0);
      cactus.add(trunk, armL, armR);
      cactus.position.set(cx, 0, cz);
      scene.add(cactus);
    }

    // Floating 3D glowing directional checkpoint arrow ahead of player!
    const wpGroup = new THREE.Group();
    const wpCone = new THREE.Mesh(
      new THREE.ConeGeometry(1.35, 3.2, 6),
      new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.92 })
    );
    wpCone.rotation.x = Math.PI / 2;
    wpCone.position.z = 1.0;
    const wpTail = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.85, 2.0),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.92 })
    );
    wpTail.position.z = -1.2;
    wpGroup.add(wpCone, wpTail);
    this.waypointMesh = wpGroup;
    scene.add(wpGroup);
  }

  private buildTrackGantry(scene: THREE.Scene, t: number, bannerText: string, accentHex: number): void {
    if (!this.trackCurve) return;
    const pt = this.trackCurve.getPointAt(t);
    const tan = this.trackCurve.getTangentAt(t);
    const gantry = new THREE.Group();
    gantry.position.set(pt.x, 0, pt.z);
    gantry.rotation.y = Math.atan2(tan.x, tan.z);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.45 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.35 });

    const span = this.trackHalfWidth + 1.8;
    const pillarL = new THREE.Mesh(new THREE.BoxGeometry(1.8, 12, 1.8), pillarMat);
    pillarL.position.set(-span, 6, 0);
    pillarL.castShadow = true;
    const pillarR = pillarL.clone();
    pillarR.position.x = span;

    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2.4, 2.8, 1.9), accentMat);
    beam.position.set(0, 11.4, 0);
    beam.castShadow = true;

    // Sign canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#141923';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(bannerText, 256, 66);

    const signTex = new THREE.CanvasTexture(canvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });
    const signFront = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2), signMat);
    signFront.position.set(0, 11.4, -1.02);
    signFront.rotation.y = Math.PI;
    const signBack = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.2), signMat);
    signBack.position.set(0, 11.4, 1.02);

    gantry.add(pillarL, pillarR, beam, signFront, signBack);
    scene.add(gantry);
  }

  private spawnRaceVehicles(scene: THREE.Scene): void {
    if (!this.trackCurve) return;
    const enableLights = this.engine.getQuality() === 'ultra';

    // 6-car staggered starting grid (player starts 6th for thrilling overtakes!)
    const gridSlots = [0.993, 0.987, 0.981, 0.975, 0.969, 0.963];
    const laneOffsets = [-6.0, 6.0, -6.0, 6.0, -6.0, 6.0];

    // Spawn 5 rivals (prioritizing other family/kid custom vehicles first!)
    for (let idx = 0; idx < 5; idx++) {
      let name: string;
      let bp: VehicleBlueprint;
      let tint: string;
      if (idx < this.otherDrivers.length) {
        const d = this.otherDrivers[idx];
        name = `${d.avatar} ${d.username}`;
        bp = cloneBlueprint(d.activeVehicle);
        tint = d.accentColor;
      } else {
        const profile = AI_RACER_PROFILES[idx % AI_RACER_PROFILES.length];
        const bpBase = STARTER_BLUEPRINTS.find((s) => s.id === profile.blueprintId) || STARTER_BLUEPRINTS[0];
        name = profile.name;
        bp = cloneBlueprint(bpBase);
        tint = profile.tint;
      }
      const v = new DriveVehicle(`ai_${idx}`, name, bp, false, false, tint);
      this.placeOnSpline(v, gridSlots[idx], laneOffsets[idx]);
      v.splineT = gridSlots[idx];
      v.totalProgress = gridSlots[idx] - 1;
      scene.add(v.root);
      this.vehicles.push(v);
    }

    // Spawn Player's custom-built vehicle!
    this.player = new DriveVehicle('player', this.playerBlueprint.name, this.playerBlueprint, true, enableLights);
    this.placeOnSpline(this.player, gridSlots[5], laneOffsets[5]);
    this.player.splineT = gridSlots[5];
    this.player.totalProgress = gridSlots[5] - 1;
    scene.add(this.player.root);
    this.vehicles.push(this.player);
  }

  private placeOnSpline(v: DriveVehicle, t: number, laneOffset: number): void {
    if (!this.trackCurve) return;
    const pt = this.trackCurve.getPointAt(((t % 1) + 1) % 1);
    const tan = this.trackCurve.getTangentAt(((t % 1) + 1) % 1).normalize();
    const side = new THREE.Vector3(-tan.z, 0, tan.x);
    v.position.set(pt.x + side.x * laneOffset, 0.1, pt.z + side.z * laneOffset);
    v.heading = Math.atan2(tan.x, tan.z);
    v.syncTransform();
  }

  // =========================================================================
  // DESTRUCTION DERBY COLISEUM & STUNT PARK (82-radius action-packed bowl!)
  // =========================================================================
  private buildDerbyArenaWorld(scene: THREE.Scene, isFreeRoam: boolean): void {
    const floorTex = createArenaFloorTexture();
    floorTex.repeat.set(18, 18);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS + 5, 72),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.72, metalness: 0.08 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Outer stadium apron
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(520, 520),
      new THREE.MeshStandardMaterial({ color: 0x1a212c, roughness: 0.9 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.1;
    scene.add(apron);

    // Painted arena racing & hazard lanes
    const ringSpecs = [
      { r1: 20, r2: 21.4, color: 0xf4be17 },
      { r1: 48, r2: 49.4, color: 0x38bdf8 },
      { r1: ARENA_RADIUS - 3.8, r2: ARENA_RADIUS - 2.2, color: 0xd92626 },
    ];
    for (const rs of ringSpecs) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(rs.r1, rs.r2, 64),
        new THREE.MeshBasicMaterial({ color: rs.color, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      scene.add(ring);
    }

    // Segmented Brick-Wall Coliseum Perimeter + Stadium Floodlight Towers!
    const wallCount = 44;
    const wallMatLight = new THREE.MeshStandardMaterial({ color: 0xbcc4d0, roughness: 0.65 });
    const wallMatRed = new THREE.MeshStandardMaterial({ color: 0xd92626, roughness: 0.45 });
    const wallMatYellow = new THREE.MeshStandardMaterial({ color: 0xf4be17, roughness: 0.45 });
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 2.0,
    });
    const segLen = (2 * Math.PI * ARENA_RADIUS) / wallCount + 0.7;

    for (let i = 0; i < wallCount; i++) {
      const ang = (i / wallCount) * Math.PI * 2;
      const wall = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(segLen, 9.0, 2.8), wallMatLight);
      base.position.y = 4.5;
      base.castShadow = true;
      base.receiveShadow = true;
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(segLen, 1.5, 3.1),
        i % 2 === 0 ? wallMatRed : wallMatYellow
      );
      stripe.position.y = 1.9;
      wall.add(base, stripe);

      if (i % 6 === 0) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(1.6, 24, 1.6), towerMat);
        pole.position.set(0, 12, 1.4);
        const bank = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.4, 1.1), lampMat);
        bank.position.set(0, 23.5, 0.2);
        wall.add(pole, bank);
      }

      wall.position.set(Math.sin(ang) * ARENA_RADIUS, 0, Math.cos(ang) * ARENA_RADIUS);
      wall.rotation.y = ang;
      scene.add(wall);
    }

    // Central Coliseum Smash Tower (in Derby/Family; Center Stunt Ramp + Turbo Runway in Stunt Park!)
    if (!isFreeRoam) {
      this.pillarRadius = 6.8;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(this.pillarRadius, this.pillarRadius + 0.8, 13, 20),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.48, metalness: 0.35 })
      );
      pillar.position.y = 6.5;
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      const band1 = new THREE.Mesh(
        new THREE.CylinderGeometry(this.pillarRadius + 0.3, this.pillarRadius + 0.3, 1.8, 20),
        wallMatYellow
      );
      band1.position.y = 2.2;
      const band2 = new THREE.Mesh(
        new THREE.CylinderGeometry(this.pillarRadius + 0.3, this.pillarRadius + 0.3, 1.3, 20),
        wallMatRed
      );
      band2.position.y = 11.6;
      scene.add(pillar, band1, band2);
    } else {
      this.pillarRadius = 0;
      // Central Stunt Park Launch Ramp + 2-pad Turbo Runway + Crisp Mid-Air Rings!
      this.createRamp(scene, 0, 0, 0, 12.5, 16, 4.6);
      this.createBoostPad(scene, new THREE.Vector3(0, 0, -24), 0);
      this.createBoostPad(scene, new THREE.Vector3(0, 0, -13), 0);
      this.createStuntRing(scene, new THREE.Vector3(0, 9.2, 20), 0);
      this.createStuntRing(scene, new THREE.Vector3(0, 7.6, 36), 0);
    }

    // 4 Inner Bowl Ramps + Reachable Stunt Rings in their flight arcs!
    this.createRamp(scene, 0, 32, 0, 9.5, 11.5, 3.4);
    this.createRamp(scene, 0, -32, Math.PI, 9.5, 11.5, 3.4);
    this.createRamp(scene, 32, 0, Math.PI / 2, 9.5, 11.5, 3.4);
    this.createRamp(scene, -32, 0, -Math.PI / 2, 9.5, 11.5, 3.4);

    this.createStuntRing(scene, new THREE.Vector3(0, 8.2, 50), 0);
    this.createStuntRing(scene, new THREE.Vector3(0, 8.2, -50), 0);
    this.createStuntRing(scene, new THREE.Vector3(50, 8.2, 0), Math.PI / 2);
    this.createStuntRing(scene, new THREE.Vector3(-50, 8.2, 0), Math.PI / 2);

    // 4 Diagonal Coiled SPRING BOUNCE PADS (snappy fun bounce that lands cleanly!)
    const springCoords: [number, number][] = [
      [24, 24],
      [-24, 24],
      [24, -24],
      [-24, -24],
    ];
    for (const [sx, sz] of springCoords) {
      this.createSpringPad(scene, new THREE.Vector3(sx, 0, sz), 23.5);
    }
    this.createStuntRing(scene, new THREE.Vector3(24, 8.5, 24), Math.PI / 4);
    this.createStuntRing(scene, new THREE.Vector3(-24, 8.5, -24), Math.PI / 4);

    // 4 Outer Speed Ring Boost Pads
    const padCoords: [number, number, number][] = [
      [42, 42, -Math.PI * 0.75],
      [-42, 42, Math.PI * 0.75],
      [42, -42, -Math.PI * 0.25],
      [-42, -42, Math.PI * 0.25],
    ];
    for (const [px, pz, rot] of padCoords) {
      this.createBoostPad(scene, new THREE.Vector3(px, 0, pz), rot);
    }

    // 4 Repair Wrenches & 4 Nitro Cores easy to spot & contest!
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      this.createPickup(scene, new THREE.Vector3(Math.sin(a) * 62, 1.5, Math.cos(a) * 62), i % 2 === 0 ? 'repair' : 'nitro');
      const aInner = a + Math.PI / 4;
      this.createPickup(scene, new THREE.Vector3(Math.sin(aInner) * 38, 1.5, Math.cos(aInner) * 38), i % 2 === 0 ? 'nitro' : 'repair');
    }

    // 24 Scatterable orange safety cones
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const conePositions: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      conePositions.push([Math.sin(a) * 52, Math.cos(a) * 52]);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      conePositions.push([Math.sin(a) * 21, Math.cos(a) * 21]);
    }
    for (const [cx, cz] of conePositions) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 1.1), coneMat);
      base.position.y = 0.08;
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.45, 10), coneMat);
      body.position.y = 0.85;
      body.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.31, 0.28, 10), whiteMat);
      stripe.position.y = 0.95;
      g.add(base, body, stripe);
      g.position.set(cx, 0, cz);
      scene.add(g);
      this.cones.push({
        mesh: g,
        pos: new THREE.Vector3(cx, 0, cz),
        vel: new THREE.Vector3(),
        angVel: new THREE.Vector3(),
        active: false,
      });
    }
  }

  private spawnArenaVehicles(scene: THREE.Scene, isFreeRoam: boolean): void {
    const enableLights = this.engine.getQuality() === 'ultra';

    this.player = new DriveVehicle('player', this.playerBlueprint.name, this.playerBlueprint, true, enableLights);
    this.player.position.set(0, 0.1, -50);
    this.player.heading = 0;
    this.player.syncTransform();
    scene.add(this.player.root);
    this.vehicles.push(this.player);

    if (isFreeRoam) return;

    // Build rival roster: in Family Clash, spawn EVERY other child's custom build first!
    // In regular Derby, also include other children's builds alongside the 8 boss heroes!
    const rivalSpecs: { name: string; bp: VehicleBlueprint; tint: string }[] = [];

    for (const drv of this.otherDrivers) {
      rivalSpecs.push({
        name: `${drv.avatar} ${drv.username}`,
        bp: cloneBlueprint(drv.activeVehicle),
        tint: drv.accentColor,
      });
    }

    const targetCount = this.mode === 'family' ? Math.max(4, rivalSpecs.length) : 8;
    let aiIdx = 0;
    while (rivalSpecs.length < targetCount) {
      const profile = AI_RACER_PROFILES[aiIdx % AI_RACER_PROFILES.length];
      const bpBase = STARTER_BLUEPRINTS.find((s) => s.id === profile.blueprintId) || STARTER_BLUEPRINTS[10];
      rivalSpecs.push({
        name: profile.name,
        bp: cloneBlueprint(bpBase),
        tint: profile.tint,
      });
      aiIdx++;
    }

    const roles: DerbyAiBrain['role'][] = ['brawler', 'flanker', 'opportunist', 'stunt_hunter'];

    rivalSpecs.forEach((spec, i) => {
      const v = new DriveVehicle(`derby_ai_${i}`, spec.name, spec.bp, false, false, spec.tint);
      v.maxHp = Math.round(v.maxHp * (0.85 + this.wave * 0.1));
      v.hp = v.maxHp;

      const ang = ((i + 1) / (rivalSpecs.length + 1)) * Math.PI * 2;
      const r = 50;
      v.position.set(Math.sin(ang) * r, 0.1, Math.cos(ang) * r);
      // Angle slightly toward a neighboring sector so AIs fan out organically at kickoff!
      const scatterAngle = ang + (i % 2 === 0 ? 0.55 : -0.55);
      v.heading = Math.atan2(-Math.sin(scatterAngle), -Math.cos(scatterAngle));
      v.syncTransform();
      scene.add(v.root);
      this.vehicles.push(v);

      const roamAng = ang + Math.PI * (0.45 + (i % 3) * 0.25);
      this.aiBrains.set(v.id, {
        role: roles[i % roles.length],
        targetId: null,
        state: i % 3 === 0 ? 'roam' : 'fight',
        decisionTimer: 1.5 + (i % 4) * 0.75,
        stuckTimer: 0,
        recoverTimer: 0,
        recoverSteer: i % 2 === 0 ? 1 : -1,
        roamTarget: new THREE.Vector3(Math.sin(roamAng) * 42, 0, Math.cos(roamAng) * 42),
        flankSign: i % 2 === 0 ? 1 : -1,
      });
    });
  }

  private createSpringPad(scene: THREE.Scene, pos: THREE.Vector3, power: number): void {
    const group = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(4.2, 4.6, 0.36, 20),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.4 })
    );
    base.position.y = 0.18;
    group.add(base);

    // 3 glowing yellow coiled spring rings
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0xf4be17,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.75,
      roughness: 0.3,
    });
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.24, 8, 18), coilMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.45 + i * 0.38;
      group.add(ring);
    }

    // Bright red/yellow bounce top cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.34, 20),
      new THREE.MeshStandardMaterial({
        color: 0xe03131,
        emissive: 0xd92626,
        emissiveIntensity: 0.55,
        roughness: 0.3,
      })
    );
    cap.position.y = 1.45;
    cap.name = 'spring_cap';
    group.add(cap);

    group.position.copy(pos);
    scene.add(group);
    this.springPads.push({ mesh: group, pos: pos.clone(), radius: 4.5, power, bounceAnim: 0 });
  }

  private createStuntRing(scene: THREE.Scene, pos: THREE.Vector3, rotY: number): void {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(6.2, 0.55, 12, 32),
      new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        emissive: 0xf59e0b,
        emissiveIntensity: 2.0,
        roughness: 0.2,
      })
    );
    ring.position.copy(pos);
    ring.rotation.y = rotY;
    scene.add(ring);
    this.stuntRings.push({ mesh: ring, pos: pos.clone(), radius: 7.4, cooldown: 0 });
  }

  private createRamp(
    scene: THREE.Scene,
    x: number,
    z: number,
    heading: number,
    width: number,
    length: number,
    height: number
  ): void {
    this.ramps.push({ x, z, heading, width, length, height });

    const shape = new THREE.Shape();
    shape.moveTo(-length / 2, 0);
    shape.lineTo(length / 2, 0);
    shape.lineTo(length / 2, height);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-Math.PI / 2);

    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xf4be17, roughness: 0.45, metalness: 0.15 })
    );
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Painted launch chevron strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.85, 0.16, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd92626, emissive: 0xd92626, emissiveIntensity: 0.4 })
    );
    strip.position.set(
      x + Math.sin(heading) * (length * 0.48),
      height - 0.05,
      z + Math.cos(heading) * (length * 0.48)
    );
    strip.rotation.y = heading;
    scene.add(strip);
  }

  private createBoostPad(scene: THREE.Scene, pos: THREE.Vector3, heading: number): void {
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.14, 7.2),
      new THREE.MeshStandardMaterial({
        color: 0x22d3ee,
        emissive: 0x06b6d4,
        emissiveIntensity: 1.9,
        roughness: 0.2,
      })
    );
    pad.position.set(pos.x, 0.08, pos.z);
    pad.rotation.y = heading;
    scene.add(pad);
    this.boostPads.push({ pos: pos.clone(), radius: 4.4 });
  }

  private createPickup(scene: THREE.Scene, pos: THREE.Vector3, type: 'repair' | 'nitro'): void {
    const group = new THREE.Group();
    const color = type === 'repair' ? 0x22c55e : 0x38e8ff;
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    if (type === 'repair') {
      const h = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.52, 0.52), mat);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.6, 0.52), mat);
      group.add(h, v);
    } else {
      const oct = new THREE.Mesh(new THREE.OctahedronGeometry(0.95, 0), mat);
      group.add(oct);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.5, 24),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -1.25;
    group.add(ring);

    group.position.copy(pos);
    scene.add(group);
    this.pickups.push({ mesh: group, pos: pos.clone(), type, cooldown: 0 });
  }

  // =========================================================================
  // GAME LOOP, AI, COLLISIONS & CAMERA
  // =========================================================================
  private getGroundHeightAndLaunch(v: DriveVehicle): number {
    let h = 0;
    for (const r of this.ramps) {
      const dx = v.position.x - r.x;
      const dz = v.position.z - r.z;
      const sin = Math.sin(r.heading);
      const cos = Math.cos(r.heading);
      // Project into ramp local space (+localZ = up the ramp)
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      if (Math.abs(localX) <= r.width * 0.56 && localZ >= -r.length * 0.54 && localZ <= r.length * 0.56) {
        const ratio = THREE.MathUtils.clamp((localZ + r.length / 2) / r.length, 0, 1);
        const rampH = ratio * r.height;
        if (rampH > h) {
          h = rampH;
          // Crisp, controlled arcade ramp launch (exciting air that lands cleanly inside the arena!)
          const fwdSpeed = v.getSpeed();
          if (ratio > 0.72 && fwdSpeed > 11 && v.grounded && v.vy < 6) {
            v.vy = Math.min(23, 9.5 + fwdSpeed * 0.34 + v.stats.springCount * 1.4);
            v.grounded = false;
            if (v.isPlayer) {
              sound.playBoing();
              this.showBanner('BIG LAUNCH! 🚀');
            }
          }
        }
      }
    }
    return h;
  }

  private getPlayerInput(): ControlInput {
    let throttle = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.touchInput.gas) throttle += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.touchInput.brake) throttle -= 1;

    let steer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft') || this.touchInput.left) steer += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight') || this.touchInput.right) steer -= 1;

    const boost = this.keys.has('Space') || this.touchInput.boost;
    const handbrake = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchInput.drift;
    const jump = this.keys.has('KeyJ') || this.keys.has('KeyF') || this.touchInput.jump;
    return { throttle, steer, boost, handbrake, jump };
  }

  private computeRaceAiInput(v: DriveVehicle, idx: number): ControlInput {
    if (!this.trackCurve) return { throttle: 0, steer: 0, boost: false, handbrake: false };
    const lookAheadT = (v.splineT + 0.042) % 1;
    const targetPt = this.trackCurve.getPointAt(lookAheadT);
    const tan = this.trackCurve.getTangentAt(lookAheadT).normalize();
    const laneOffset = ((idx % 3) - 1) * 7.0;
    targetPt.x += -tan.z * laneOffset;
    targetPt.z += tan.x * laneOffset;

    const desiredHeading = Math.atan2(targetPt.x - v.position.x, targetPt.z - v.position.z);
    let diff = desiredHeading - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
    const sharpTurn = Math.abs(diff) > 0.55;
    const distDelta = this.player.totalProgress - v.totalProgress;
    const throttle = sharpTurn ? 0.72 : distDelta > 0.12 ? 1.0 : 0.92;
    const boost = !sharpTurn && v.boost > 55 && (distDelta > 0.05 || Math.sin(this.elapsedTime * 1.4 + idx) > 0.78);
    return { throttle, steer, boost, handbrake: Math.abs(diff) > 0.95 };
  }

  private computeDerbyAiInput(v: DriveVehicle, dt: number): ControlInput {
    const brain = this.aiBrains.get(v.id);
    if (!brain) {
      return { throttle: 0.7, steer: 0, boost: false, handbrake: false };
    }

    // 1. Stuck detection & clean reverse-out recovery so AIs never deadlock
    if (brain.recoverTimer > 0) {
      brain.recoverTimer -= dt;
      return { throttle: -0.95, steer: brain.recoverSteer, boost: false, handbrake: false };
    }
    if (v.getSpeed() < 3.4) {
      brain.stuckTimer += dt;
      if (brain.stuckTimer > 0.65) {
        brain.stuckTimer = 0;
        brain.recoverTimer = 0.85;
        brain.recoverSteer = Math.random() < 0.5 ? -1 : 1;
        brain.decisionTimer = 0;
        return { throttle: -0.95, steer: brain.recoverSteer, boost: false, handbrake: false };
      }
    } else {
      brain.stuckTimer = Math.max(0, brain.stuckTimer - dt * 1.5);
    }

    // 2. Periodic intelligent tactical decision (keeps commitments instead of twitching at player!)
    brain.decisionTimer -= dt;
    const hpRatio = v.hp / Math.max(1, v.maxHp);

    // Check if current target got wrecked
    const curTarget = brain.targetId
      ? this.vehicles.find((o) => o.id === brain.targetId && !o.wrecked) || null
      : null;
    if (brain.state === 'fight' && !curTarget) {
      brain.decisionTimer = 0;
    }

    // Retaliation interrupt: if someone (AI or player) just slammed us hard, fight them back!
    if (
      v.lastHitBy &&
      !v.lastHitBy.wrecked &&
      v.lastHitBy !== v &&
      this.elapsedTime - v.lastHitTime < 3.5 &&
      brain.targetId !== v.lastHitBy.id &&
      hpRatio >= 0.42
    ) {
      brain.state = 'fight';
      brain.targetId = v.lastHitBy.id;
      brain.decisionTimer = 3.2;
    }

    if (brain.decisionTimer <= 0) {
      brain.decisionTimer = 2.4 + Math.random() * 2.4;
      brain.flankSign = Math.random() < 0.5 ? 1 : -1;

      // Priority A: Low HP? Break off and hunt the nearest Repair Wrench!
      const bestRepair = hpRatio < 0.48 ? this.findNearestPickup(v.position, 'repair', 165) : null;
      if (bestRepair) {
        brain.state = 'heal';
        brain.targetId = null;
        brain.roamTarget.copy(bestRepair.pos);
      } else {
        // Priority B: Low Nitro & Nitro Core nearby? Grab it!
        const bestNitro = v.boost < 28 ? this.findNearestPickup(v.position, 'nitro', 62) : null;
        if (bestNitro && Math.random() < 0.65) {
          brain.state = 'nitro';
          brain.targetId = null;
          brain.roamTarget.copy(bestNitro.pos);
        } else if (brain.role === 'stunt_hunter' && Math.random() < 0.28 && this.springPads.length > 0) {
          // Priority C: Stunt hunters occasionally hit springs / ramps across the stadium!
          brain.state = 'roam';
          brain.targetId = null;
          const pad = this.springPads[Math.floor(Math.random() * this.springPads.length)];
          brain.roamTarget.copy(pad.pos);
        } else {
          // Priority D: Pick a rival! Count how many OTHER AIs already target the player so they NEVER all swarm you!
          const aliveAis = this.vehicles.filter((o) => !o.isPlayer && !o.wrecked).length;
          let otherPlayerHunters = 0;
          for (const [id, b] of this.aiBrains) {
            if (id === v.id || b.state !== 'fight' || b.targetId !== this.player.id) continue;
            const owner = this.vehicles.find((o) => o.id === id && !o.wrecked);
            if (owner) otherPlayerHunters++;
          }

          // At kickoff (< 3.8s), AIs duel each other first unless you charge right into them!
          const maxHunters = aliveAis >= 5 ? 2 : 1;
          const allowPlayer =
            aliveAis <= 1 ||
            (this.elapsedTime > 3.8 && otherPlayerHunters < maxHunters) ||
            v.position.distanceTo(this.player.position) < 28;

          let chosen: DriveVehicle | null = null;
          let bestScore = Infinity;

          for (const other of this.vehicles) {
            if (other === v || other.wrecked) continue;
            if (other.isPlayer && !allowPlayer) continue;

            const dist = v.position.distanceTo(other.position);
            let score = dist;

            // Slight preference for AI-vs-AI rivalries early so the whole stadium erupts in action!
            if (other.isPlayer && aliveAis > 2) {
              score *= 1.18;
            }
            // Opportunists hunt whichever car has the lowest HP % to steal KOs!
            if (brain.role === 'opportunist') {
              const otherHpRatio = other.hp / Math.max(1, other.maxHp);
              score *= 0.65 + otherHpRatio * 0.7;
            }
            // Small variety jitter so everyone doesn't pick the exact same car
            score *= 0.85 + Math.random() * 0.3;

            if (score < bestScore) {
              bestScore = score;
              chosen = other;
            }
          }

          if (chosen) {
            brain.state = 'fight';
            brain.targetId = chosen.id;
          } else {
            brain.state = 'roam';
            brain.targetId = null;
            const randAng = Math.random() * Math.PI * 2;
            const randR = 20 + Math.random() * 44;
            brain.roamTarget.set(Math.sin(randAng) * randR, 0, Math.cos(randAng) * randR);
          }
        }
      }
    }

    // 3. Compute steering waypoint from current tactical state
    let targetX = brain.roamTarget.x;
    let targetZ = brain.roamTarget.z;
    let targetDist = Math.hypot(targetX - v.position.x, targetZ - v.position.z);
    let wantsRamBoost = false;

    if (brain.state === 'fight' && curTarget) {
      targetDist = v.position.distanceTo(curTarget.position);
      const lead = brain.role === 'flanker' ? 0.5 : 0.3;
      targetX = curTarget.position.x + curTarget.velocity.x * lead;
      targetZ = curTarget.position.z + curTarget.velocity.z * lead;

      // Flankers swing wide at medium range to T-bone targets cleanly instead of nose-locking!
      if (brain.role === 'flanker' && targetDist > 18 && targetDist < 48) {
        const dx = targetX - v.position.x;
        const dz = targetZ - v.position.z;
        const len = Math.max(1, Math.hypot(dx, dz));
        targetX += (-dz / len) * 11 * brain.flankSign;
        targetZ += (dx / len) * 11 * brain.flankSign;
      }
      wantsRamBoost = targetDist < 36 && targetDist > 9 && v.boost > 36;
    } else if (brain.state === 'heal' || brain.state === 'nitro') {
      // If someone already grabbed our pickup, re-decide immediately
      if (targetDist < 5.5) {
        brain.decisionTimer = 0;
      }
      wantsRamBoost = targetDist > 22 && v.boost > 55;
    } else if (brain.state === 'roam' && targetDist < 10) {
      brain.decisionTimer = 0;
    }

    // 4. Smart obstacle avoidance: skirt smoothly around the central smash pillar & outer walls
    const distFromCenter = Math.hypot(v.position.x, v.position.z);
    if (this.pillarRadius > 0 && distFromCenter < this.pillarRadius + 9) {
      // Steer tangentially around the pillar rather than bouncing off it
      const rx = v.position.x / Math.max(0.1, distFromCenter);
      const rz = v.position.z / Math.max(0.1, distFromCenter);
      const tx = -rz * brain.flankSign;
      const tz = rx * brain.flankSign;
      targetX = v.position.x + (rx * 8 + tx * 14);
      targetZ = v.position.z + (rz * 8 + tz * 14);
    } else if (distFromCenter > ARENA_RADIUS - 13) {
      // Curve back inward before scraping the coliseum wall
      targetX = targetX * 0.45;
      targetZ = targetZ * 0.45;
    }

    const desiredHeading = Math.atan2(targetX - v.position.x, targetZ - v.position.z);
    let diff = desiredHeading - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
    const aligned = Math.abs(diff) < 0.34;
    const boost = aligned && wantsRamBoost;
    const throttle = Math.abs(diff) > 1.35 ? 0.65 : 1.0;
    const jump =
      brain.role === 'stunt_hunter' &&
      v.stats.springCount > 0 &&
      v.grounded &&
      v.jumpCooldown <= 0 &&
      targetDist < 16 &&
      Math.random() < 0.015;
    return { throttle, steer, boost, handbrake: Math.abs(diff) > 1.1, jump };
  }

  private findNearestPickup(pos: THREE.Vector3, type: 'repair' | 'nitro', maxRange: number): PickupDef | null {
    let best: PickupDef | null = null;
    let bestSq = maxRange * maxRange;
    for (const p of this.pickups) {
      if (p.type !== type || p.cooldown > 0) continue;
      const dx = p.pos.x - pos.x;
      const dz = p.pos.z - pos.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = p;
      }
    }
    return best;
  }

  private resolveCollisions(): void {
    const isBattleMode = this.mode === 'derby' || this.mode === 'family';

    // 1. Vehicle-to-Vehicle collisions with balanced multi-hit durability (~10-14 slams to wreck!)
    for (let i = 0; i < this.vehicles.length; i++) {
      const a = this.vehicles[i];
      if (a.wrecked) continue;
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const b = this.vehicles[j];
        if (b.wrecked) continue;

        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const dist = Math.hypot(dx, dz);
        const minDist = a.radius + b.radius;

        // Skip collision if one car jumped cleanly over the other!
        if (Math.abs(a.position.y - b.position.y) > 5.0) continue;

        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = minDist - dist;

          const totalMass = a.stats.mass + b.stats.mass;
          a.position.x -= nx * overlap * (b.stats.mass / totalMass);
          a.position.z -= nz * overlap * (b.stats.mass / totalMass);
          b.position.x += nx * overlap * (a.stats.mass / totalMass);
          b.position.z += nz * overlap * (a.stats.mass / totalMass);

          const rvx = a.velocity.x - b.velocity.x;
          const rvz = a.velocity.z - b.velocity.z;
          const closingSpeed = rvx * nx + rvz * nz;

          if (closingSpeed > 0.5) {
            const impulse = closingSpeed * 1.15;
            a.velocity.x -= nx * impulse * (b.stats.mass / totalMass);
            a.velocity.z -= nz * impulse * (b.stats.mass / totalMass);
            b.velocity.x += nx * impulse * (a.stats.mass / totalMass);
            b.velocity.z += nz * impulse * (a.stats.mass / totalMass);

            const minCrashSpeed = isBattleMode ? 7.5 : 14;
            if (closingSpeed > minCrashSpeed) {
              const impactPt = new THREE.Vector3(
                (a.position.x + b.position.x) * 0.5,
                Math.max(a.position.y, b.position.y) + 1.4,
                (a.position.z + b.position.z) * 0.5
              );

              const aFwdDot = a.getForwardVector().x * nx + a.getForwardVector().z * nz;
              const bFwdDot = -(b.getForwardVector().x * nx + b.getForwardVector().z * nz);

              // Balanced damage with 14% maxHp single-hit cap so battles last 10+ exciting crashes!
              const modeScale = isBattleMode ? 1.85 : 0.4;
              const rawDmgToB =
                (closingSpeed - 4.5) *
                modeScale *
                a.stats.physRamMultiplier *
                (aFwdDot > 0.45 ? 1.32 : 0.78) *
                (a.isBoosting ? 1.25 : 1.0);
              const rawDmgToA =
                (closingSpeed - 4.5) *
                modeScale *
                b.stats.physRamMultiplier *
                (bFwdDot > 0.45 ? 1.32 : 0.78) *
                (b.isBoosting ? 1.25 : 1.0);

              const dmgToB = Math.min(b.maxHp * 0.14, Math.max(12, rawDmgToB));
              const dmgToA = Math.min(a.maxHp * 0.14, Math.max(12, rawDmgToA));

              if (b.damageCooldown <= 0) {
                b.damageCooldown = 0.55;
                const bWrecked = b.applyDamage(dmgToB, impactPt, this.debris, a);
                if (a.isPlayer && isBattleMode) {
                  this.score += Math.round(dmgToB * 5);
                }
                if (bWrecked) {
                  this.handleWreckEvent(b, a);
                }
              }

              if (a.damageCooldown <= 0) {
                a.damageCooldown = 0.55;
                const aWrecked = a.applyDamage(dmgToA, impactPt, this.debris, b);
                if (b.isPlayer && isBattleMode) {
                  this.score += Math.round(dmgToA * 5);
                }
                if (aWrecked) {
                  this.handleWreckEvent(a, b);
                }
              }

              if (a.isPlayer || b.isPlayer) {
                const intensity = Math.min(1.2, closingSpeed / 34);
                this.cameraShake = Math.max(this.cameraShake, intensity * 0.85);
                sound.playCrash(intensity);
                if (navigator.vibrate) navigator.vibrate(Math.round(40 * intensity));
              }
            }
          }
        }
      }
    }

    // 2. Arena walls, smash pillar, spring bounce pads, stunt rings, boost pads & pickups
    for (const v of this.vehicles) {
      if (v.wrecked) continue;

      if (this.mode !== 'race') {
        const dist = Math.hypot(v.position.x, v.position.z);
        const maxR = ARENA_RADIUS - v.radius - 1.2;
        if (dist > maxR) {
          const nx = v.position.x / dist;
          const nz = v.position.z / dist;
          v.position.x = nx * maxR;
          v.position.z = nz * maxR;
          const outSpeed = v.velocity.x * nx + v.velocity.z * nz;
          if (outSpeed > 0) {
            v.velocity.x -= nx * outSpeed * 1.45;
            v.velocity.z -= nz * outSpeed * 1.45;
            if (outSpeed > 26 && isBattleMode && v.damageCooldown <= 0) {
              v.damageCooldown = 0.65;
              const wallPt = new THREE.Vector3(nx * ARENA_RADIUS, 1.2, nz * ARENA_RADIUS);
              const wallDmg = Math.min(v.maxHp * 0.08, (outSpeed - 20) * 1.1);
              const wrecked = v.applyDamage(wallDmg, wallPt, this.debris, v.lastHitBy);
              if (v.isPlayer) {
                sound.playCrash(0.55);
                this.cameraShake = Math.max(this.cameraShake, 0.45);
              }
              if (wrecked) this.handleWreckEvent(v, v.lastHitBy);
            }
          }
        }

        // Central Smash Pillar collision
        if (this.pillarRadius > 0 && v.position.y < 14) {
          const minPillar = this.pillarRadius + v.radius;
          if (dist < minPillar && dist > 0.01) {
            const nx = v.position.x / dist;
            const nz = v.position.z / dist;
            v.position.x = nx * minPillar;
            v.position.z = nz * minPillar;
            const inSpeed = -(v.velocity.x * nx + v.velocity.z * nz);
            if (inSpeed > 0) {
              v.velocity.x += nx * inSpeed * 1.5;
              v.velocity.z += nz * inSpeed * 1.5;
              if (inSpeed > 18 && v.isPlayer) {
                sound.playCrash(0.55);
                this.cameraShake = Math.max(this.cameraShake, 0.45);
              }
            }
          }
        }
      } else if (this.trackCurve) {
        this.updateRaceSplineProgress(v);
      }

      // Coiled SPRING BOUNCE PADS (snappy fun hop that lands cleanly!)
      for (const sp of this.springPads) {
        if (v.position.y > 3.2) continue;
        const dx = v.position.x - sp.pos.x;
        const dz = v.position.z - sp.pos.z;
        if (dx * dx + dz * dz < sp.radius * sp.radius && v.vy < 10) {
          v.vy = Math.min(26, sp.power + v.stats.springCount * 1.5);
          v.grounded = false;
          v.boost = Math.min(100, v.boost + 30);
          const fwd = v.getForwardVector();
          v.velocity.addScaledVector(fwd, 5);
          sp.bounceAnim = 1.0;
          this.debris.spawnSparks(sp.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), 18);
          if (v.isPlayer) {
            sound.playBoing();
            this.score += 250;
            this.showBanner('SPRING BOUNCE! 🌀');
            if (navigator.vibrate) navigator.vibrate(35);
          }
        }
      }

      // Floating Golden STUNT RINGS in mid-air!
      for (const ring of this.stuntRings) {
        if (ring.cooldown > 0) continue;
        if (v.position.distanceTo(ring.pos) < ring.radius) {
          ring.cooldown = 3.0;
          v.boost = 100;
          this.debris.spawnSparks(ring.pos, 26);
          if (v.isPlayer) {
            sound.playRingChime();
            this.score += 1000;
            this.showBanner('STUNT RING! +1,000 • FULL BOOST! ⭐');
            if (navigator.vibrate) navigator.vibrate(45);
          }
        }
      }

      // Boost Pads
      for (const pad of this.boostPads) {
        if (v.position.y > 2.5) continue;
        if (v.position.distanceToSquared(pad.pos) < pad.radius * pad.radius) {
          v.boost = Math.min(100, v.boost + 40);
          const fwd = v.getForwardVector();
          const curSpd = v.getSpeed();
          if (curSpd < v.stats.physMaxSpeed + 16) {
            v.velocity.addScaledVector(fwd, 11);
          }
          if (v.isPlayer && !this.eventBannerTimer) {
            sound.playPickup(false);
          }
        }
      }

      // Pickups (Repair Wrench / Nitro Core)
      for (const p of this.pickups) {
        if (p.cooldown > 0) continue;
        const dx = v.position.x - p.pos.x;
        const dz = v.position.z - p.pos.z;
        if (dx * dx + dz * dz < 14 && v.position.y < 5) {
          p.cooldown = 7.5;
          p.mesh.visible = false;
          if (p.type === 'repair') {
            v.repair(0.55);
            if (v.isPlayer) {
              sound.playPickup(true);
              this.showBanner('BRICKS REPAIRED +55% 🔧');
            }
          } else {
            v.boost = 100;
            if (v.isPlayer) {
              sound.playPickup(false);
              this.showBanner('NITRO FULL! ⚡');
            }
          }
        }
      }
    }

    // 3. Knockable orange traffic cones
    for (const c of this.cones) {
      for (const v of this.vehicles) {
        if (v.wrecked || v.position.y > 3.5) continue;
        const dx = c.pos.x - v.position.x;
        const dz = c.pos.z - v.position.z;
        const r = v.radius + 0.6;
        if (dx * dx + dz * dz < r * r) {
          c.active = true;
          c.vel.set(v.velocity.x * 1.15 + dx * 4, 5 + v.getSpeed() * 0.25, v.velocity.z * 1.15 + dz * 4);
          c.angVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
        }
      }
    }
  }

  private updateRaceSplineProgress(v: DriveVehicle): void {
    const N = this.trackSamples.length;
    if (N === 0) return;

    const curIdx = Math.floor((((v.splineT % 1) + 1) % 1) * N);
    let bestIdx = curIdx;
    let bestDistSq = Infinity;

    for (let offset = -18; offset <= 28; offset++) {
      const idx = (curIdx + offset + N) % N;
      const sample = this.trackSamples[idx];
      const dx = v.position.x - sample.x;
      const dz = v.position.z - sample.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = idx;
      }
    }

    // Full-track fallback scan if a car ever launched or jumped far outside the local search window!
    if (bestDistSq > 700) {
      for (let idx = 0; idx < N; idx++) {
        const sample = this.trackSamples[idx];
        const dx = v.position.x - sample.x;
        const dz = v.position.z - sample.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
    }

    const newT = bestIdx / N;
    let deltaT = newT - v.splineT;
    if (deltaT < -0.5) {
      deltaT += 1;
      v.lap++;
      if (v.isPlayer && v.lap <= TOTAL_LAPS) {
        sound.playPickup(false);
        this.showBanner(v.lap === TOTAL_LAPS ? 'FINAL LAP!' : `LAP ${v.lap} / ${TOTAL_LAPS}`);
      }
    } else if (deltaT > 0.5) {
      deltaT -= 1;
      v.lap = Math.max(1, v.lap - 1);
    }

    v.splineT = newT;
    v.totalProgress += deltaT;

    // Smooth racing guardrail sliding right at the visible red/white brick barriers — NEVER gets stuck!
    const dist = Math.sqrt(bestDistSq);
    const railLimit = this.trackHalfWidth + 0.55 - Math.min(2.0, v.radius * 0.42);
    if (dist > railLimit && dist > 0.01) {
      const sample = this.trackSamples[bestIdx];
      const tan = this.trackTangents[bestIdx];
      const nx = (v.position.x - sample.x) / dist;
      const nz = (v.position.z - sample.z) / dist;

      // Keep car cleanly inside the visible guardrail
      v.position.x = sample.x + nx * railLimit;
      v.position.z = sample.z + nz * railLimit;

      // Reflect ONLY the outward perpendicular velocity so forward momentum glides cleanly along the wall!
      const outVel = v.velocity.x * nx + v.velocity.z * nz;
      if (outVel > 0) {
        v.velocity.x -= nx * outVel * 1.28;
        v.velocity.z -= nz * outVel * 1.28;
        v.velocity.multiplyScalar(0.95);
        if (v.isPlayer && outVel > 14) {
          sound.playCrash(Math.min(0.45, outVel / 42));
          this.cameraShake = Math.max(this.cameraShake, 0.25);
        }
      }

      // Gently nudge heading toward track tangent if pinned nose-first into the barrier at low speed
      const fwd = v.getForwardVector();
      const noseIntoWall = fwd.x * nx + fwd.z * nz;
      if (noseIntoWall > 0.55 && v.getSpeed() < 12) {
        const trackHeading = Math.atan2(tan.x, tan.z);
        let hDiff = trackHeading - v.heading;
        while (hDiff > Math.PI) hDiff -= Math.PI * 2;
        while (hDiff < -Math.PI) hDiff += Math.PI * 2;
        v.heading += Math.sign(hDiff) * 0.06;
      }
    }

    // Wrong-way indicator for the player
    if (v.isPlayer && this.trackTangents[bestIdx]) {
      const fwd = v.getForwardVector();
      const tan = this.trackTangents[bestIdx];
      const alignment = fwd.x * tan.x + fwd.z * tan.z;
      if (alignment < -0.45 && v.getSpeed() > 4) {
        this.wrongWayTimer += 0.016;
        if (this.wrongWayTimer > 0.5 && this.eventBannerTimer <= 0.1) {
          this.showBanner('WRONG WAY! TURN AROUND ↩');
        }
      } else {
        this.wrongWayTimer = 0;
      }
    }

    if (!v.finished && v.totalProgress >= TOTAL_LAPS) {
      v.finished = true;
      v.finishTime = this.elapsedTime;
      if (v.isPlayer && !this.finished) {
        const pos = this.getPlayerRacePosition();
        this.finished = true;
        this.won = pos === 1;
        this.finishMessage = pos === 1 ? '1ST PLACE VICTORY!' : `FINISHED #${pos}!`;
        this.finishSubtext = `Time: ${this.elapsedTime.toFixed(2)}s • ${this.player.getBricksRemaining()}/${this.player.getBricksTotal()} bricks intact`;
        sound.playVictory();
        this.onMatchEnd?.(this.kos, this.won);
      }
    }
  }

  private handleWreckEvent(victim: DriveVehicle, attacker: DriveVehicle | null): void {
    sound.playCrash(1.15);
    this.cameraShake = Math.max(this.cameraShake, 1.0);

    if (victim.isPlayer) {
      this.finished = true;
      this.won = false;
      this.finishMessage = 'VEHICLE WRECKED!';
      this.finishSubtext = `Score: ${this.score.toLocaleString()} • KOs: ${this.kos} • Upgrade armor in the Garage!`;
      this.onMatchEnd?.(this.kos, false);
      return;
    }

    if (attacker && attacker.isPlayer) {
      this.kos++;
      this.score += 1000 * this.wave;
      this.player.boost = Math.min(100, this.player.boost + 45);
      this.showBanner(`WRECKED ${victim.name.toUpperCase()}! +${1000 * this.wave}`);
    } else if (attacker && attacker !== victim) {
      this.showBanner(`💥 ${attacker.name.toUpperCase()} KO'D ${victim.name.toUpperCase()}!`);
    } else {
      this.showBanner(`${victim.name.toUpperCase()} WRECKED!`);
    }

    if (this.mode === 'derby' || this.mode === 'family') {
      const aliveRivals = this.vehicles.filter((v) => !v.isPlayer && !v.wrecked).length;
      if (aliveRivals === 0 && !this.finished) {
        this.finished = true;
        this.won = true;
        this.score += 2500 * this.wave;
        this.finishMessage =
          this.mode === 'family' ? '🏆 FAMILY CLASH CHAMPION!' : `WAVE ${this.wave} CHAMPION!`;
        this.finishSubtext = `Total Score: ${this.score.toLocaleString()} • KOs: ${this.kos}`;
        sound.playVictory();
        this.onMatchEnd?.(this.kos, true);
      }
    }
  }

  public getCameraLabel(): string {
    return ['Chase', 'Wide', 'Hood'][this.cameraMode] || 'Chase';
  }

  private showBanner(text: string): void {
    this.eventBanner = text;
    this.eventBannerTimer = 1.55;
  }

  private getPlayerRacePosition(): number {
    let rank = 1;
    for (const v of this.vehicles) {
      if (v === this.player) continue;
      if (v.totalProgress > this.player.totalProgress) rank++;
    }
    return rank;
  }

  private updateCamera(dt: number, snap = false): void {
    const cam = this.engine.camera;
    const fwd = this.player.getForwardVector();
    const speedRatio = Math.min(1, this.player.getSpeed() / 52);
    const isLandscape = window.innerWidth > window.innerHeight;
    const roofY = this.player.roofY;
    const frontZ = this.player.frontZ;

    // Dynamic FOV warp when firing plasma thrusters
    const baseFov = this.cameraMode === 2 ? 68 : isLandscape ? 58 : 64;
    const targetFov = this.player.isBoosting ? baseFov + 9 : baseFov + speedRatio * 5;
    cam.fov = snap ? targetFov : THREE.MathUtils.lerp(cam.fov, targetFov, dt * 6);
    cam.updateProjectionMatrix();

    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;

    if (this.cameraMode === 2) {
      // HOOD / BUMPER CAM — mounted high on the nose looking slightly downward onto the road!
      const hoodY = Math.max(3.0, Math.min(roofY * 0.85, 4.8));
      desiredPos = this.player.position
        .clone()
        .addScaledVector(fwd, frontZ + 0.4)
        .add(new THREE.Vector3(0, hoodY, 0));
      desiredLook = this.player.position
        .clone()
        .addScaledVector(fwd, 28)
        .add(new THREE.Vector3(0, Math.max(1.2, hoodY - 1.35), 0));
      if (snap) {
        this.camPosCurrent.copy(desiredPos);
        this.camLookCurrent.copy(desiredLook);
      } else {
        this.camPosCurrent.lerp(desiredPos, Math.min(1, dt * 24));
        this.camLookCurrent.lerp(desiredLook, Math.min(1, dt * 26));
      }
    } else {
      // Camera 0: Elevated Hero Chase (~19° down) | Camera 1: High Tactical (~26° down)
      const isWide = this.cameraMode === 1;
      const dist = isWide
        ? Math.max(16.5, frontZ * 2.7 + 6.2)
        : Math.max(13.0, frontZ * 2.3 + 4.8);
      const height = isWide
        ? Math.max(14.0, roofY + 9.6)
        : Math.max(8.8, roofY + 5.2);
      const lookAhead = isWide ? 10.5 : 9.5;
      const lookY = isWide ? 0.8 : 1.2;

      desiredPos = this.player.position
        .clone()
        .addScaledVector(fwd, -dist)
        .add(new THREE.Vector3(0, height, 0));

      // Keep camera safely inside stadium walls in Derby / Family / Stunt Park!
      if (this.mode !== 'race') {
        const camDist = Math.hypot(desiredPos.x, desiredPos.z);
        const maxCamR = ARENA_RADIUS - 3.5;
        if (camDist > maxCamR) {
          desiredPos.x = (desiredPos.x / camDist) * maxCamR;
          desiredPos.z = (desiredPos.z / camDist) * maxCamR;
          desiredPos.y = Math.max(desiredPos.y, height + 2.5);
        }
      }

      desiredLook = this.player.position
        .clone()
        .addScaledVector(fwd, lookAhead)
        .add(new THREE.Vector3(0, lookY, 0));

      if (snap) {
        this.camPosCurrent.copy(desiredPos);
        this.camLookCurrent.copy(desiredLook);
      } else {
        this.camPosCurrent.lerp(desiredPos, Math.min(1, dt * 8.5));
        this.camLookCurrent.lerp(desiredLook, Math.min(1, dt * 12));
      }
    }

    // Apply impact camera shake
    if (this.cameraShake > 0.01) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 3.0);
      const mag = this.cameraShake * 0.65;
      cam.position.set(
        this.camPosCurrent.x + (Math.random() - 0.5) * mag,
        this.camPosCurrent.y + (Math.random() - 0.5) * mag,
        this.camPosCurrent.z + (Math.random() - 0.5) * mag
      );
    } else {
      cam.position.copy(this.camPosCurrent);
    }
    cam.lookAt(this.camLookCurrent);

    // Keep shadow frustum centered on player for razor-sharp shadows everywhere on track!
    if (this.sunLight) {
      this.sunLight.position.set(this.player.position.x + 42, 68, this.player.position.z + 32);
      this.sunLight.target.position.copy(this.player.position);
      this.sunLight.target.updateMatrixWorld();
    }
  }

  private drawMinimap(): void {
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(13, 18, 26, 0.78)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 14);
    ctx.fill();

    if (this.mode === 'race' && this.trackSamples.length > 0) {
      // Fit expanded 1.42x track bounds into canvas
      const mapX = (x: number) => 16 + ((x + 45) / 435) * (w - 32);
      const mapY = (z: number) => 16 + ((z + 290) / 580) * (h - 32);

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.45)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      this.trackSamples.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(mapX(p.x), mapY(p.z));
        else ctx.lineTo(mapX(p.x), mapY(p.z));
      });
      ctx.closePath();
      ctx.stroke();

      for (const v of this.vehicles) {
        ctx.fillStyle = v.isPlayer ? '#38e8ff' : '#f4be17';
        ctx.beginPath();
        ctx.arc(mapX(v.position.x), mapY(v.position.z), v.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Circular arena radar
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) * 0.42;
      ctx.strokeStyle = 'rgba(244, 190, 23, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      for (const v of this.vehicles) {
        if (v.wrecked) continue;
        const px = cx + (v.position.x / ARENA_RADIUS) * r;
        const py = cy + (v.position.z / ARENA_RADIUS) * r;
        ctx.fillStyle = v.isPlayer ? '#38e8ff' : '#ef4444';
        ctx.beginPath();
        ctx.arc(px, py, v.isPlayer ? 5 : 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  public update(dt: number, fps: number): HudState {
    if (!this.active) {
      return this.getHudState(fps);
    }

    if (this.paused) {
      return this.getHudState(fps);
    }

    // Race / Derby 3-2-1-GO countdown
    let canDrive = true;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const cInt = Math.ceil(this.countdown);
      if (cInt < this.lastCountdownInt && cInt > 0) {
        this.lastCountdownInt = cInt;
        sound.playCountdown(false);
      }
      if (this.countdown <= 0) {
        sound.playCountdown(true);
        this.countdown = -0.01;
        this.showBanner('GO! GO! GO!');
      } else {
        canDrive = false;
      }
    } else if (!this.finished) {
      this.elapsedTime += dt;
    }

    if (this.eventBannerTimer > 0) {
      this.eventBannerTimer -= dt;
      if (this.eventBannerTimer <= 0) this.eventBanner = '';
    }

    // Update pickups spin & respawn cooldown
    for (const p of this.pickups) {
      if (p.cooldown > 0) {
        p.cooldown -= dt;
        if (p.cooldown <= 0) p.mesh.visible = true;
      } else {
        p.mesh.rotation.y += dt * 2.2;
        p.mesh.position.y = 1.45 + Math.sin(this.elapsedTime * 3.5) * 0.22;
      }
    }

    // Update knocked cones
    for (const c of this.cones) {
      if (!c.active) continue;
      c.vel.y -= 28 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.angVel.x * dt;
      c.mesh.rotation.y += c.angVel.y * dt;
      c.mesh.rotation.z += c.angVel.z * dt;
      if (c.pos.y < 0) {
        c.pos.y = 0;
        c.vel.y = Math.abs(c.vel.y) * 0.35;
        c.vel.x *= 0.82;
        c.vel.z *= 0.82;
        c.angVel.multiplyScalar(0.8);
      }
      c.mesh.position.copy(c.pos);
    }

    // Animate Bounce Spring Pads & Floating Golden Stunt Rings!
    for (const sp of this.springPads) {
      if (sp.bounceAnim > 0) {
        sp.bounceAnim = Math.max(0, sp.bounceAnim - dt * 3.8);
        const stretch = 1 + Math.sin(sp.bounceAnim * Math.PI * 2) * 0.42;
        sp.mesh.scale.set(1, stretch, 1);
      } else {
        sp.mesh.scale.set(1, 1, 1);
      }
    }
    for (const ring of this.stuntRings) {
      if (ring.cooldown > 0) ring.cooldown = Math.max(0, ring.cooldown - dt);
      ring.mesh.rotation.z += dt * 1.4;
      const pulse = 1 + Math.sin(this.elapsedTime * 4) * 0.04;
      ring.mesh.scale.setScalar(ring.cooldown > 0 ? 0.85 : pulse);
    }

    // Update all vehicles
    const playerInput = this.getPlayerInput();
    this.vehicles.forEach((v, idx) => {
      const gh = this.getGroundHeightAndLaunch(v);
      let input: ControlInput;
      if (v.isPlayer) {
        input = this.finished ? { throttle: 0, steer: 0, boost: false, handbrake: true } : playerInput;
      } else {
        input = this.mode === 'race' ? this.computeRaceAiInput(v, idx) : this.computeDerbyAiInput(v, dt);
      }
      v.updatePhysics(dt, input, gh, this.debris, canDrive);
      if (v.isPlayer) {
        if (v.justHopped) {
          sound.playBoing();
        }
        if (v.justLandedAirTime > 0.72) {
          const pts = Math.round(v.justLandedAirTime * 450);
          this.score += pts;
          this.showBanner(`BIG AIR ${v.justLandedAirTime.toFixed(1)}s! +${pts}`);
        }
      }
    });

    this.resolveCollisions();
    this.debris.update(dt);

    // Update floating 3D directional race arrow ahead of player pointing down the track!
    if (this.waypointMesh && this.trackCurve) {
      const wpT = (this.player.splineT + 0.055) % 1;
      const wpPt = this.trackCurve.getPointAt(wpT);
      const wpTan = this.trackCurve.getTangentAt(wpT).normalize();
      this.waypointMesh.position.set(wpPt.x, 4.4 + Math.sin(this.elapsedTime * 5) * 0.45, wpPt.z);
      this.waypointMesh.rotation.y = Math.atan2(wpTan.x, wpTan.z);
    }

    this.updateCamera(dt);
    this.drawMinimap();

    // Update live Web Audio engine & jet sound
    sound.updateDrivingAudio(
      this.player.getSpeed() / Math.max(1, this.player.stats.physMaxSpeed),
      canDrive ? playerInput.throttle : 0,
      this.player.isBoosting
    );

    return this.getHudState(fps);
  }

  private getHudState(fps: number): HudState {
    let waypointDist = 0;
    if (this.mode === 'race' && this.waypointMesh && this.player) {
      waypointDist = Math.round(this.player.position.distanceTo(this.waypointMesh.position) * 2.2);
    }
    const aliveCount = this.vehicles.filter((v) => !v.wrecked).length;
    return {
      mode: this.mode,
      speedKmh: this.player ? Math.round(this.player.getSpeed() * 3.6) : 0,
      boost: this.player ? Math.round(this.player.boost) : 0,
      hp: this.player ? Math.round(this.player.hp) : 0,
      maxHp: this.player ? Math.round(this.player.maxHp) : 100,
      bricksRemaining: this.player ? this.player.getBricksRemaining() : 0,
      bricksTotal: this.player ? this.player.getBricksTotal() : 0,
      countdown: this.countdown > 0 ? Math.ceil(this.countdown) : -1,
      lap: this.player ? Math.min(TOTAL_LAPS, this.player.lap) : 1,
      totalLaps: TOTAL_LAPS,
      position: this.mode === 'race' && this.player ? this.getPlayerRacePosition() : 1,
      totalRacers: this.vehicles.length,
      raceTime: this.elapsedTime,
      waypointDist,
      kos: this.kos,
      aliveCount,
      score: this.score,
      wave: this.wave,
      finished: this.finished,
      won: this.won,
      finishMessage: this.finishMessage,
      finishSubtext: this.finishSubtext,
      eventBanner: this.eventBanner,
      fps,
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    this.keys.add(e.code);
    if (e.code === 'KeyC') this.cycleCamera();
    if (e.code === 'KeyR') this.resetPlayerPosition();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private unbindEvents(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
