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
import type { GameMode, HudState, VehicleBlueprint } from './types';

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

export interface TouchInputState {
  left: boolean;
  right: boolean;
  gas: boolean;
  brake: boolean;
  boost: boolean;
  drift: boolean;
}

const ARENA_RADIUS = 62;
const TOTAL_LAPS = 3;

export class GameWorldController {
  private engine: GraphicsEngine;
  private mode: Exclude<GameMode, 'garage'> = 'race';
  private active = false;
  private paused = false;

  private vehicles: DriveVehicle[] = [];
  private player!: DriveVehicle;
  private debris!: DebrisSystem;

  // Race track spline & metadata
  private trackCurve: THREE.CatmullRomCurve3 | null = null;
  private trackSamples: THREE.Vector3[] = [];
  private trackHalfWidth = 10.5;
  private waypointMesh: THREE.Mesh | null = null;

  // World interactive props
  private ramps: RampDef[] = [];
  private boostPads: BoostPadDef[] = [];
  private pickups: PickupDef[] = [];
  private cones: KnockableCone[] = [];
  private pillarRadius = 6.2;

  // Input state
  private keys = new Set<string>();
  public touchInput: TouchInputState = {
    left: false,
    right: false,
    gas: false,
    brake: false,
    boost: false,
    drift: false,
  };

  // Match & camera state
  private countdown = 3.2;
  private lastCountdownInt = 4;
  private elapsedTime = 0;
  private cameraMode = 0; // 0 = dynamic chase, 1 = close action, 2 = high tactical
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

  // Minimap callback
  public minimapCanvas: HTMLCanvasElement | null = null;

  constructor(engine: GraphicsEngine) {
    this.engine = engine;
  }

  public enter(mode: Exclude<GameMode, 'garage'>, playerBlueprint: VehicleBlueprint, wave = 1): void {
    this.mode = mode;
    this.active = true;
    this.paused = false;
    this.wave = wave;
    this.playerBlueprint = cloneBlueprint(playerBlueprint);

    this.vehicles = [];
    this.ramps = [];
    this.boostPads = [];
    this.pickups = [];
    this.cones = [];
    this.trackCurve = null;
    this.trackSamples = [];
    this.waypointMesh = null;

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
    this.eventBanner = mode === 'derby' ? `WAVE ${wave} — SMASH ALL RIVALS!` : mode === 'freeroam' ? 'STUNT PARK — TEST YOUR BUILD!' : '';
    this.eventBannerTimer = 2.6;

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

    // Initialize camera smoothly behind player
    const fwd = this.player.getForwardVector();
    this.camPosCurrent.copy(this.player.position).addScaledVector(fwd, -13).add(new THREE.Vector3(0, 6.2, 0));
    this.camLookCurrent.copy(this.player.position).add(new THREE.Vector3(0, 1.5, 0));
    this.engine.camera.position.copy(this.camPosCurrent);
    this.engine.camera.lookAt(this.camLookCurrent);

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
      this.player.position.set(0, 1.2, -32);
      this.player.heading = 0;
      this.player.velocity.set(0, 0, 0);
      this.player.vy = 0;
    }
    this.player.syncTransform();
    sound.playUiTick();
  }

  private setupLighting(scene: THREE.Scene): void {
    const isRace = this.mode === 'race';
    const skyColor = isRace ? 0x62a8e5 : 0x2a3444;
    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(skyColor, isRace ? 130 : 90, isRace ? 420 : 250);

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
  // RED ROCK CANYON CIRCUIT RACE (Inspired by Screenshot 3!)
  // =========================================================================
  private buildCanyonRaceWorld(scene: THREE.Scene): void {
    // Expansive desert canyon ground
    const groundTex = createCanyonGroundTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    scene.add(ground);

    // Sweeping closed canyon racing circuit
    const controlPts = [
      new THREE.Vector3(0, 0, -40),
      new THREE.Vector3(0, 0, 90),
      new THREE.Vector3(55, 0, 175),
      new THREE.Vector3(165, 0, 175),
      new THREE.Vector3(230, 0, 95),
      new THREE.Vector3(185, 0, 5),
      new THREE.Vector3(245, 0, -95),
      new THREE.Vector3(175, 0, -180),
      new THREE.Vector3(60, 0, -165),
      new THREE.Vector3(5, 0, -115),
    ];
    this.trackCurve = new THREE.CatmullRomCurve3(controlPts, true, 'catmullrom', 0.5);

    const SEGMENTS = 260;
    this.trackSamples = [];
    for (let i = 0; i < SEGMENTS; i++) {
      this.trackSamples.push(this.trackCurve.getPointAt(i / SEGMENTS));
    }

    // Build custom UV-mapped ribbon mesh for the asphalt + kerbs road!
    const roadWidth = this.trackHalfWidth * 2;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i % SEGMENTS) / SEGMENTS;
      const pt = this.trackCurve.getPointAt(t);
      const tan = this.trackCurve.getTangentAt(t).normalize();
      const side = new THREE.Vector3(-tan.z, 0, tan.x).multiplyScalar(roadWidth / 2);

      positions.push(pt.x - side.x, 0.04, pt.z - side.z);
      positions.push(pt.x + side.x, 0.04, pt.z + side.z);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, i * 0.45, 1, i * 0.45);

      if (i < SEGMENTS) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
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
      new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.72, metalness: 0.06 })
    );
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    // Start / Finish Brick Gantry + DYNAMO Overhead Arch (nod to Screenshot 3!)
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
      this.createRamp(scene, pt.x, pt.z, Math.atan2(tan.x, tan.z), 8.5, 11.0, 2.8);
    }

    // Brick-built Red Rock Canyon Mesas & Buttes framing the circuit!
    const mesaMat1 = new THREE.MeshStandardMaterial({ color: 0xb84a27, roughness: 0.85 });
    const mesaMat2 = new THREE.MeshStandardMaterial({ color: 0xd46a38, roughness: 0.85 });
    const mesaMat3 = new THREE.MeshStandardMaterial({ color: 0x91351b, roughness: 0.88 });
    const mats = [mesaMat1, mesaMat2, mesaMat3];

    const mesaSpecs = [
      { x: -65, z: 65, w: 36, h: 38, d: 34 },
      { x: -58, z: -60, w: 32, h: 28, d: 38 },
      { x: 115, z: 75, w: 34, h: 42, d: 30 },
      { x: 110, z: -55, w: 38, h: 36, d: 36 },
      { x: 285, z: 160, w: 46, h: 52, d: 44 },
      { x: 310, z: -25, w: 42, h: 46, d: 48 },
      { x: 270, z: -225, w: 48, h: 40, d: 38 },
      { x: -10, z: 225, w: 50, h: 48, d: 38 },
      { x: 125, z: 245, w: 44, h: 36, d: 34 },
      { x: 65, z: -240, w: 46, h: 44, d: 36 },
    ];

    for (const m of mesaSpecs) {
      const mesa = new THREE.Group();
      // 3 stacked blocky brick-style canyon tiers
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

    // Brick-built desert cacti & trackside chevron signs
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x2d8a47, roughness: 0.6 });
    for (let i = 0; i < 36; i++) {
      const t = i / 36;
      const pt = this.trackCurve.getPointAt(t);
      const tan = this.trackCurve.getTangentAt(t);
      const sideSign = i % 2 === 0 ? 1 : -1;
      const offset = (this.trackHalfWidth + 6 + (i % 3) * 4) * sideSign;
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

    // Floating cyan checkpoint beacon ahead of player
    const wpGeo = new THREE.OctahedronGeometry(1.3, 0);
    this.waypointMesh = new THREE.Mesh(
      wpGeo,
      new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.88 })
    );
    scene.add(this.waypointMesh);
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
    const gridSlots = [0.992, 0.985, 0.978, 0.971, 0.964, 0.957];
    const laneOffsets = [-3.6, 3.6, -3.6, 3.6, -3.6, 3.6];

    // Spawn 5 AI racers
    AI_RACER_PROFILES.forEach((profile, idx) => {
      const bpBase = STARTER_BLUEPRINTS.find((s) => s.id === profile.blueprintId) || STARTER_BLUEPRINTS[0];
      const v = new DriveVehicle(`ai_${idx}`, profile.name, cloneBlueprint(bpBase), false, false, profile.tint);
      this.placeOnSpline(v, gridSlots[idx], laneOffsets[idx]);
      v.splineT = gridSlots[idx];
      v.totalProgress = gridSlots[idx] - 1;
      scene.add(v.root);
      this.vehicles.push(v);
    });

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
  // DESTRUCTION DERBY BOWL ARENA & STUNT PARK (Inspired by Screenshot 2!)
  // =========================================================================
  private buildDerbyArenaWorld(scene: THREE.Scene, isFreeRoam: boolean): void {
    const floorTex = createArenaFloorTexture();
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS + 4, 64),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.72, metalness: 0.08 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Outer stadium apron
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 360),
      new THREE.MeshStandardMaterial({ color: 0x1d232e, roughness: 0.9 })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.1;
    scene.add(apron);

    // Painted arena hazard rings
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(18, 19.2, 48),
      new THREE.MeshBasicMaterial({ color: 0xf4be17, side: THREE.DoubleSide })
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.03;
    scene.add(innerRing);

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(ARENA_RADIUS - 3.5, ARENA_RADIUS - 2.3, 64),
      new THREE.MeshBasicMaterial({ color: 0xd92626, side: THREE.DoubleSide })
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.03;
    scene.add(outerRing);

    // Segmented Brick-Wall Stadium Perimeter (like Screenshot 2's concrete brick walls!)
    const wallCount = 32;
    const wallMatLight = new THREE.MeshStandardMaterial({ color: 0xc2c8d2, roughness: 0.65 });
    const wallMatAccent = new THREE.MeshStandardMaterial({ color: 0xd92626, roughness: 0.45 });
    const segLen = (2 * Math.PI * ARENA_RADIUS) / wallCount + 0.6;

    for (let i = 0; i < wallCount; i++) {
      const ang = (i / wallCount) * Math.PI * 2;
      const wall = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(segLen, 8.5, 2.4), wallMatLight);
      base.position.y = 4.25;
      base.castShadow = true;
      base.receiveShadow = true;
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(segLen, 1.3, 2.65),
        i % 2 === 0 ? wallMatAccent : new THREE.MeshStandardMaterial({ color: 0xf4be17, roughness: 0.45 })
      );
      stripe.position.y = 1.6;
      wall.add(base, stripe);
      wall.position.set(Math.sin(ang) * ARENA_RADIUS, 0, Math.cos(ang) * ARENA_RADIUS);
      wall.rotation.y = ang;
      scene.add(wall);
    }

    // Central reinforced Smash Pillar (in Derby mode; open jump centerpiece in Free Roam)
    if (!isFreeRoam) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(this.pillarRadius, this.pillarRadius + 0.6, 11, 16),
        new THREE.MeshStandardMaterial({ color: 0x4b5361, roughness: 0.48, metalness: 0.3 })
      );
      pillar.position.y = 5.5;
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(this.pillarRadius + 0.25, this.pillarRadius + 0.25, 1.6, 16),
        new THREE.MeshStandardMaterial({ color: 0xf4be17, roughness: 0.4 })
      );
      band.position.y = 2.0;
      scene.add(pillar, band);
    } else {
      this.pillarRadius = 0;
    }

    // 4 Stunt Jump Ramps positioned symmetrically around the bowl
    this.createRamp(scene, 0, 28, 0, 8.2, 10.5, 3.2);
    this.createRamp(scene, 0, -28, Math.PI, 8.2, 10.5, 3.2);
    this.createRamp(scene, 28, 0, Math.PI / 2, 8.2, 10.5, 3.2);
    this.createRamp(scene, -28, 0, -Math.PI / 2, 8.2, 10.5, 3.2);

    // 4 Boost pads
    this.createBoostPad(scene, new THREE.Vector3(24, 0, 24), -Math.PI * 0.75);
    this.createBoostPad(scene, new THREE.Vector3(-24, 0, 24), Math.PI * 0.75);
    this.createBoostPad(scene, new THREE.Vector3(24, 0, -24), -Math.PI * 0.25);
    this.createBoostPad(scene, new THREE.Vector3(-24, 0, -24), Math.PI * 0.25);

    // Repair Wrench & Nitro Core pickups
    this.createPickup(scene, new THREE.Vector3(0, 1.4, 44), 'repair');
    this.createPickup(scene, new THREE.Vector3(0, 1.4, -44), 'repair');
    this.createPickup(scene, new THREE.Vector3(44, 1.4, 0), 'nitro');
    this.createPickup(scene, new THREE.Vector3(-44, 1.4, 0), 'nitro');

    // Scatterable orange safety cones (inspired by Screenshot 2!)
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.45 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const conePositions: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      conePositions.push([Math.sin(a) * 38, Math.cos(a) * 38]);
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
    this.player.position.set(0, 0.1, -36);
    this.player.heading = 0;
    this.player.syncTransform();
    scene.add(this.player.root);
    this.vehicles.push(this.player);

    if (isFreeRoam) return;

    // Spawn 5 AI Derby contenders in a ring facing inward!
    const count = 5;
    for (let i = 0; i < count; i++) {
      const profile = AI_RACER_PROFILES[i % AI_RACER_PROFILES.length];
      const bpBase = STARTER_BLUEPRINTS.find((s) => s.id === profile.blueprintId) || STARTER_BLUEPRINTS[3];
      const v = new DriveVehicle(`derby_ai_${i}`, profile.name, cloneBlueprint(bpBase), false, false, profile.tint);
      // Scale rival durability slightly on later waves
      v.maxHp = Math.round(v.maxHp * (0.85 + this.wave * 0.14));
      v.hp = v.maxHp;

      const ang = ((i + 1) / (count + 1)) * Math.PI * 2;
      const r = 38;
      v.position.set(Math.sin(ang) * r, 0.1, Math.cos(ang) * r);
      v.heading = Math.atan2(-v.position.x, -v.position.z);
      v.syncTransform();
      scene.add(v.root);
      this.vehicles.push(v);
    }
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
      if (Math.abs(localX) <= r.width * 0.54 && localZ >= -r.length * 0.52 && localZ <= r.length * 0.52) {
        const ratio = THREE.MathUtils.clamp((localZ + r.length / 2) / r.length, 0, 1);
        const rampH = ratio * r.height;
        if (rampH > h) {
          h = rampH;
          // Launch airborne near the lip!
          const fwdSpeed = v.getSpeed();
          if (ratio > 0.84 && fwdSpeed > 18 && v.grounded && v.vy < 4) {
            v.vy = Math.min(20, fwdSpeed * 0.42);
            v.grounded = false;
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
    return { throttle, steer, boost, handbrake };
  }

  private computeRaceAiInput(v: DriveVehicle, idx: number): ControlInput {
    if (!this.trackCurve) return { throttle: 0, steer: 0, boost: false, handbrake: false };
    const lookAheadT = (v.splineT + 0.045) % 1;
    const targetPt = this.trackCurve.getPointAt(lookAheadT);
    const tan = this.trackCurve.getTangentAt(lookAheadT).normalize();
    const laneOffset = ((idx % 3) - 1) * 3.1;
    targetPt.x += -tan.z * laneOffset;
    targetPt.z += tan.x * laneOffset;

    const desiredHeading = Math.atan2(targetPt.x - v.position.x, targetPt.z - v.position.z);
    let diff = desiredHeading - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    const steer = THREE.MathUtils.clamp(diff * 2.4, -1, 1);
    const sharpTurn = Math.abs(diff) > 0.55;
    // Slight rubber-banding so races stay exciting & competitive!
    const distDelta = this.player.totalProgress - v.totalProgress;
    const throttle = sharpTurn ? 0.72 : distDelta > 0.12 ? 1.0 : 0.9;
    const boost = !sharpTurn && v.boost > 55 && (distDelta > 0.05 || Math.sin(this.elapsedTime * 1.4 + idx) > 0.78);
    return { throttle, steer, boost, handbrake: Math.abs(diff) > 0.9 };
  }

  private computeDerbyAiInput(v: DriveVehicle): ControlInput {
    // Pick nearest alive opponent (with slight preference for hunting the player!)
    let bestTarget: DriveVehicle | null = null;
    let bestScore = Infinity;
    for (const other of this.vehicles) {
      if (other === v || other.wrecked) continue;
      let dist = v.position.distanceTo(other.position);
      if (other.isPlayer) dist *= 0.82;
      if (dist < bestScore) {
        bestScore = dist;
        bestTarget = other;
      }
    }

    if (!bestTarget) return { throttle: 0, steer: 0, boost: false, handbrake: false };

    // Avoid central smash pillar
    let targetX = bestTarget.position.x + bestTarget.velocity.x * 0.35;
    let targetZ = bestTarget.position.z + bestTarget.velocity.z * 0.35;

    const distFromCenter = Math.hypot(v.position.x, v.position.z);
    if (distFromCenter < this.pillarRadius + 6.5) {
      targetX = v.position.x * 2.2;
      targetZ = v.position.z * 2.2;
    }

    const desiredHeading = Math.atan2(targetX - v.position.x, targetZ - v.position.z);
    let diff = desiredHeading - v.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    // If pinned close to wall or pillar at low speed, reverse briefly
    if (v.getSpeed() < 3.5 && Math.abs(diff) > 1.7) {
      return { throttle: -0.9, steer: diff > 0 ? -1 : 1, boost: false, handbrake: false };
    }

    const steer = THREE.MathUtils.clamp(diff * 2.5, -1, 1);
    const aligned = Math.abs(diff) < 0.38;
    const boost = aligned && bestScore < 34 && bestScore > 7 && v.boost > 35;
    return { throttle: 1.0, steer, boost, handbrake: Math.abs(diff) > 1.05 };
  }

  private resolveCollisions(): void {
    // 1. Vehicle-to-Vehicle collisions with ram multiplier & brick shedding!
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

        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const nz = dz / dist;
          const overlap = minDist - dist;

          // Separate vehicles proportionally by mass
          const totalMass = a.stats.mass + b.stats.mass;
          a.position.x -= nx * overlap * (b.stats.mass / totalMass);
          a.position.z -= nz * overlap * (b.stats.mass / totalMass);
          b.position.x += nx * overlap * (a.stats.mass / totalMass);
          b.position.z += nz * overlap * (a.stats.mass / totalMass);

          // Relative closing speed along collision normal
          const rvx = a.velocity.x - b.velocity.x;
          const rvz = a.velocity.z - b.velocity.z;
          const closingSpeed = rvx * nx + rvz * nz;

          if (closingSpeed > 0.5) {
            const impulse = closingSpeed * 1.18;
            a.velocity.x -= nx * impulse * (b.stats.mass / totalMass);
            a.velocity.z -= nz * impulse * (b.stats.mass / totalMass);
            b.velocity.x += nx * impulse * (a.stats.mass / totalMass);
            b.velocity.z += nz * impulse * (a.stats.mass / totalMass);

            // Damage calculation (heavy in Derby, lighter in Race!)
            const minCrashSpeed = this.mode === 'derby' ? 7.5 : 15;
            if (closingSpeed > minCrashSpeed) {
              const impactPt = new THREE.Vector3(
                (a.position.x + b.position.x) * 0.5,
                1.2,
                (a.position.z + b.position.z) * 0.5
              );

              // Check who rammed front-first! Front rams & spike plows deal huge damage while protecting the rammer!
              const aFwdDot = a.getForwardVector().x * nx + a.getForwardVector().z * nz;
              const bFwdDot = -(b.getForwardVector().x * nx + b.getForwardVector().z * nz);

              const modeScale = this.mode === 'derby' ? 1.55 : 0.42;
              const dmgToB = Math.max(
                4,
                (closingSpeed - 5) * modeScale * a.stats.physRamMultiplier * (aFwdDot > 0.45 ? 1.38 : 0.85) * (a.isBoosting ? 1.35 : 1.0)
              );
              const dmgToA = Math.max(
                4,
                (closingSpeed - 5) * modeScale * b.stats.physRamMultiplier * (bFwdDot > 0.45 ? 1.38 : 0.85) * (b.isBoosting ? 1.35 : 1.0)
              );

              if (b.damageCooldown <= 0) {
                b.damageCooldown = 0.25;
                const bWrecked = b.applyDamage(dmgToB, impactPt, this.debris, a);
                if (a.isPlayer && this.mode === 'derby') {
                  this.score += Math.round(dmgToB * 10);
                }
                if (bWrecked) {
                  this.handleWreckEvent(b, a);
                }
              }

              if (a.damageCooldown <= 0) {
                a.damageCooldown = 0.25;
                const aWrecked = a.applyDamage(dmgToA, impactPt, this.debris, b);
                if (b.isPlayer && this.mode === 'derby') {
                  this.score += Math.round(dmgToA * 10);
                }
                if (aWrecked) {
                  this.handleWreckEvent(a, b);
                }
              }

              if (a.isPlayer || b.isPlayer) {
                const intensity = Math.min(1.2, closingSpeed / 28);
                this.cameraShake = Math.max(this.cameraShake, intensity * 0.9);
                sound.playCrash(intensity);
                if (navigator.vibrate) navigator.vibrate(Math.round(45 * intensity));
              }
            }
          }
        }
      }
    }

    // 2. Arena walls & central smash pillar (or Race track soft guardrails)
    for (const v of this.vehicles) {
      if (v.wrecked) continue;

      if (this.mode === 'derby' || this.mode === 'freeroam') {
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
            if (outSpeed > 18 && this.mode === 'derby' && v.damageCooldown <= 0) {
              v.damageCooldown = 0.35;
              const wallPt = new THREE.Vector3(nx * ARENA_RADIUS, 1.2, nz * ARENA_RADIUS);
              const wrecked = v.applyDamage((outSpeed - 14) * 0.75, wallPt, this.debris, v.lastHitBy);
              if (v.isPlayer) {
                sound.playCrash(0.6);
                this.cameraShake = Math.max(this.cameraShake, 0.5);
              }
              if (wrecked) this.handleWreckEvent(v, v.lastHitBy);
            }
          }
        }

        // Central Smash Pillar collision
        if (this.pillarRadius > 0) {
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
              if (inSpeed > 15 && v.isPlayer) {
                sound.playCrash(0.55);
                this.cameraShake = Math.max(this.cameraShake, 0.45);
              }
            }
          }
        }
      } else if (this.mode === 'race' && this.trackCurve) {
        // Keep racers near track corridor & update spline lap progression
        this.updateRaceSplineProgress(v);
      }

      // Boost Pads
      for (const pad of this.boostPads) {
        if (v.position.distanceToSquared(pad.pos) < pad.radius * pad.radius) {
          v.boost = Math.min(100, v.boost + 35);
          const fwd = v.getForwardVector();
          const curSpd = v.getSpeed();
          if (curSpd < v.stats.physMaxSpeed + 18) {
            v.velocity.addScaledVector(fwd, 14);
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
        if (dx * dx + dz * dz < 11) {
          p.cooldown = 12;
          p.mesh.visible = false;
          if (p.type === 'repair') {
            v.repair(0.45);
            if (v.isPlayer) {
              sound.playPickup(true);
              this.showBanner('BRICKS REPAIRED +45%');
            }
          } else {
            v.boost = 100;
            if (v.isPlayer) {
              sound.playPickup(false);
              this.showBanner('NITRO FULL!');
            }
          }
        }
      }
    }

    // 3. Knockable orange traffic cones
    for (const c of this.cones) {
      for (const v of this.vehicles) {
        if (v.wrecked) continue;
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

    // Local search around current splineT (fast + prevents shortcut jumping!)
    const curIdx = Math.floor(((v.splineT % 1) + 1) % 1 * N);
    let bestIdx = curIdx;
    let bestDistSq = Infinity;

    for (let offset = -14; offset <= 24; offset++) {
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

    // Off-road drag + soft canyon wall boundary
    const dist = Math.sqrt(bestDistSq);
    if (dist > this.trackHalfWidth + 1.5) {
      v.velocity.multiplyScalar(0.985);
    }
    const maxCorridor = this.trackHalfWidth + 10;
    if (dist > maxCorridor) {
      const sample = this.trackSamples[bestIdx];
      const nx = (v.position.x - sample.x) / dist;
      const nz = (v.position.z - sample.z) / dist;
      v.position.x = sample.x + nx * maxCorridor;
      v.position.z = sample.z + nz * maxCorridor;
      v.velocity.multiplyScalar(0.75);
    }

    // Check race finish
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
      return;
    }

    if (attacker && attacker.isPlayer) {
      this.kos++;
      this.score += 1000 * this.wave;
      this.player.boost = Math.min(100, this.player.boost + 40);
      this.showBanner(`WRECKED ${victim.name.toUpperCase()}! +${1000 * this.wave}`);
    } else {
      this.showBanner(`${victim.name.toUpperCase()} WRECKED!`);
    }

    // Check if player is the last vehicle standing!
    if (this.mode === 'derby') {
      const aliveRivals = this.vehicles.filter((v) => !v.isPlayer && !v.wrecked).length;
      if (aliveRivals === 0 && !this.finished) {
        this.finished = true;
        this.won = true;
        this.score += 2500 * this.wave;
        this.finishMessage = `WAVE ${this.wave} CHAMPION!`;
        this.finishSubtext = `Total Score: ${this.score.toLocaleString()} • KOs: ${this.kos} • Ready for Wave ${this.wave + 1}?`;
        sound.playVictory();
      }
    }
  }

  private showBanner(text: string): void {
    this.eventBanner = text;
    this.eventBannerTimer = 2.4;
  }

  private getPlayerRacePosition(): number {
    let rank = 1;
    for (const v of this.vehicles) {
      if (v === this.player) continue;
      if (v.totalProgress > this.player.totalProgress) rank++;
    }
    return rank;
  }

  private updateCamera(dt: number): void {
    const cam = this.engine.camera;
    const fwd = this.player.getForwardVector();
    const speedRatio = Math.min(1, this.player.getSpeed() / 55);

    // Dynamic FOV warp when firing plasma thrusters (like Screenshot 3!)
    const targetFov = this.player.isBoosting ? 74 : 58 + speedRatio * 7;
    cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, dt * 6);
    cam.updateProjectionMatrix();

    let dist = 12.2;
    let height = 5.4;
    let lookAhead = 5.5;
    if (this.cameraMode === 1) {
      dist = 8.4;
      height = 3.5;
      lookAhead = 8.0;
    } else if (this.cameraMode === 2) {
      dist = 18.5;
      height = 12.5;
      lookAhead = 3.5;
    }

    const desiredPos = this.player.position
      .clone()
      .addScaledVector(fwd, -dist)
      .add(new THREE.Vector3(0, height, 0));
    const desiredLook = this.player.position
      .clone()
      .addScaledVector(fwd, lookAhead)
      .add(new THREE.Vector3(0, 1.5, 0));

    this.camPosCurrent.lerp(desiredPos, Math.min(1, dt * 7.5));
    this.camLookCurrent.lerp(desiredLook, Math.min(1, dt * 11));

    // Apply impact camera shake
    if (this.cameraShake > 0.01) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.8);
      const mag = this.cameraShake * 0.75;
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
      // Fit track bounds into canvas
      const mapX = (x: number) => 16 + ((x + 30) / 305) * (w - 32);
      const mapY = (z: number) => 16 + ((z + 205) / 410) * (h - 32);

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

    // Update all vehicles
    const playerInput = this.getPlayerInput();
    this.vehicles.forEach((v, idx) => {
      const gh = this.getGroundHeightAndLaunch(v);
      let input: ControlInput;
      if (v.isPlayer) {
        input = this.finished ? { throttle: 0, steer: 0, boost: false, handbrake: true } : playerInput;
      } else {
        input = this.mode === 'race' ? this.computeRaceAiInput(v, idx) : this.computeDerbyAiInput(v);
      }
      v.updatePhysics(dt, input, gh, this.debris, canDrive);
    });

    this.resolveCollisions();
    this.debris.update(dt);

    // Update floating race waypoint ahead of player
    if (this.waypointMesh && this.trackCurve) {
      const wpT = (this.player.splineT + 0.08) % 1;
      const wpPt = this.trackCurve.getPointAt(wpT);
      this.waypointMesh.position.set(wpPt.x, 4.6 + Math.sin(this.elapsedTime * 5) * 0.5, wpPt.z);
      this.waypointMesh.rotation.y += dt * 3;
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
