import * as THREE from 'three';
import {
  PARTS_MAP,
  PLATE_HEIGHT,
  STUD_SIZE,
  calculateVehicleStats,
  getBrickCenterWorld,
} from './catalog';
import { createBrickMesh } from './brickMesh';
import type { PlacedBrick, VehicleBlueprint, VehicleStats } from './types';

export interface ControlInput {
  throttle: number; // -1..1
  steer: number; // -1..1 (+1 = left, -1 = right)
  boost: boolean;
  handbrake: boolean;
  jump?: boolean;
}

interface AttachedBrick {
  data: PlacedBrick;
  mesh: THREE.Group;
  localPos: THREE.Vector3;
  isCore: boolean;
  isWheel: boolean;
  detached: boolean;
}

interface WheelRef {
  pivot: THREE.Group;
  spinMesh: THREE.Object3D;
  isFront: boolean;
  radius: number;
}

interface ThrusterRef {
  flame: THREE.Object3D;
  localPos: THREE.Vector3;
}

interface DebrisPiece {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  life: number;
  maxLife: number;
  isParticle: boolean;
}

/**
 * Shared 3D Physics Debris & FX System:
 * Handles flying shattered LEGO bricks, glowing impact sparks,
 * cyan plasma boost trails, and drift dust puffs.
 */
export class DebrisSystem {
  private scene: THREE.Scene;
  private pieces: DebrisPiece[] = [];
  private sparkGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
  private smokeGeo = new THREE.DodecahedronGeometry(0.32, 0);
  private sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  private cyanBoostMat = new THREE.MeshBasicMaterial({
    color: 0x38e8ff,
    transparent: true,
    opacity: 0.85,
  });
  private smokeMat = new THREE.MeshBasicMaterial({
    color: 0xdbe3ee,
    transparent: true,
    opacity: 0.48,
  });
  private maxPieces: number;

  constructor(scene: THREE.Scene, maxPieces = 260) {
    this.scene = scene;
    this.maxPieces = maxPieces;
  }

  public spawnDetachedBrick(brick: PlacedBrick, worldPos: THREE.Vector3, worldQuat: THREE.Quaternion, velocity: THREE.Vector3): void {
    this.trimIfFull();
    const mesh = createBrickMesh(brick.partId, brick.color);
    mesh.scale.setScalar(1.28);
    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);
    this.scene.add(mesh);

    this.pieces.push({
      mesh,
      vel: velocity.clone(),
      angVel: new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      ),
      life: 0,
      maxLife: 5.5 + Math.random() * 2.5,
      isParticle: false,
    });
  }

  public spawnSparks(pos: THREE.Vector3, count = 14): void {
    for (let i = 0; i < count; i++) {
      this.trimIfFull();
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.position.copy(pos);
      this.scene.add(m);
      this.pieces.push({
        mesh: m,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 24,
          4 + Math.random() * 14,
          (Math.random() - 0.5) * 24
        ),
        angVel: new THREE.Vector3(10, 10, 10),
        life: 0,
        maxLife: 0.45 + Math.random() * 0.35,
        isParticle: true,
      });
    }
  }

  public spawnBoostParticle(pos: THREE.Vector3, backwardVel: THREE.Vector3): void {
    this.trimIfFull();
    const m = new THREE.Mesh(this.sparkGeo, this.cyanBoostMat);
    m.position.copy(pos);
    m.scale.setScalar(1.3);
    this.scene.add(m);
    this.pieces.push({
      mesh: m,
      vel: backwardVel.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * 3.5, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 3.5)
      ),
      angVel: new THREE.Vector3(5, 5, 5),
      life: 0,
      maxLife: 0.28 + Math.random() * 0.16,
      isParticle: true,
    });
  }

  public spawnSmoke(pos: THREE.Vector3, count = 2): void {
    for (let i = 0; i < count; i++) {
      this.trimIfFull();
      const m = new THREE.Mesh(this.smokeGeo, this.smokeMat);
      m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.2, (Math.random() - 0.5) * 0.5));
      this.scene.add(m);
      this.pieces.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 1.8 + Math.random() * 2.5, (Math.random() - 0.5) * 3),
        angVel: new THREE.Vector3(1, 2, 1),
        life: 0,
        maxLife: 0.55 + Math.random() * 0.3,
        isParticle: true,
      });
    }
  }

  private trimIfFull(): void {
    if (this.pieces.length >= this.maxPieces) {
      const oldest = this.pieces.shift();
      if (oldest) this.scene.remove(oldest.mesh);
    }
  }

  public update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        this.pieces.splice(i, 1);
        continue;
      }

      if (!p.isParticle) {
        p.vel.y -= 30 * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += p.angVel.x * dt;
        p.mesh.rotation.y += p.angVel.y * dt;
        p.mesh.rotation.z += p.angVel.z * dt;
        if (p.mesh.position.y < 0.28) {
          p.mesh.position.y = 0.28;
          p.vel.y = Math.abs(p.vel.y) * 0.42;
          p.vel.x *= 0.78;
          p.vel.z *= 0.78;
          p.angVel.multiplyScalar(0.8);
        }
        // Shrink out in the final 0.7s
        const rem = p.maxLife - p.life;
        if (rem < 0.7) {
          p.mesh.scale.setScalar(Math.max(0.01, rem / 0.7));
        }
      } else {
        p.mesh.position.addScaledVector(p.vel, dt);
        const t = p.life / p.maxLife;
        p.mesh.scale.setScalar(Math.max(0.05, 1.15 - t * 1.1));
      }
    }
  }
}

/**
 * Live 3D Drivable & Destructible Brick Vehicle built dynamically from ANY VehicleBlueprint.
 */
export class DriveVehicle {
  public readonly id: string;
  public readonly name: string;
  public readonly isPlayer: boolean;
  public readonly stats: VehicleStats;
  public readonly root = new THREE.Group();
  public readonly bodyTilt = new THREE.Group();

  public position = new THREE.Vector3();
  public velocity = new THREE.Vector3();
  public heading = 0; // radians around Y (0 = facing +Z)
  public yawRate = 0;
  public vy = 0;
  public grounded = true;
  public radius = 2.6;
  public frontZ = 2.6;
  public roofY = 3.0;

  public boost = 100;
  public isBoosting = false;
  public isDrifting = false;
  public hp: number;
  public maxHp: number;
  public wrecked = false;
  public hitFlash = 0;
  public damageCooldown = 0;
  public jumpCooldown = 0;
  public airTime = 0;
  public justLandedAirTime = 0;
  public justHopped = false;

  // Race / Derby tracking
  public lap = 1;
  public splineT = 0;
  public totalProgress = 0;
  public finished = false;
  public finishTime = 0;
  public lastHitBy: DriveVehicle | null = null;
  public lastHitTime = 0;

  private bricks: AttachedBrick[] = [];
  private wheels: WheelRef[] = [];
  private thrusters: ThrusterRef[] = [];
  private saws: THREE.Object3D[] = [];
  private boostLight: THREE.PointLight | null = null;
  private nameplateSprite: THREE.Sprite | null = null;
  private boostParticleTimer = 0;
  private smokeTimer = 0;
  private currentSteerVisual = 0;

  constructor(
    id: string,
    name: string,
    blueprint: VehicleBlueprint,
    isPlayer: boolean,
    enableBoostLight: boolean,
    nameplateColor?: string
  ) {
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.stats = calculateVehicleStats(blueprint.bricks);
    this.maxHp = this.stats.physMaxHp;
    this.hp = this.maxHp;

    this.root.add(this.bodyTilt);
    this.assembleFromBlueprint(blueprint, enableBoostLight);

    if (!isPlayer && nameplateColor) {
      this.nameplateSprite = this.createNameplate(name, nameplateColor);
      this.nameplateSprite.position.set(0, Math.max(4.6, this.roofY + 1.5), 0);
      this.root.add(this.nameplateSprite);
    }
  }

  private assembleFromBlueprint(blueprint: VehicleBlueprint, enableBoostLight: boolean): void {
    if (blueprint.bricks.length === 0) return;

    // Compute horizontal center (X, Z) and lowest bottom Y so wheels sit flush at y=0
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let minBottomY = Infinity;
    let maxTopY = -Infinity;

    const centers = blueprint.bricks.map((b) => {
      const c = getBrickCenterWorld(b);
      const part = PARTS_MAP[b.partId];
      const halfY = part.isWheel ? (part.wheelRadius ?? 0.85) + PLATE_HEIGHT * 0.25 : (part.h * PLATE_HEIGHT) / 2;
      const halfX = (part.w * STUD_SIZE) / 2;
      const halfZ = (part.d * STUD_SIZE) / 2;
      minX = Math.min(minX, c.x - halfX);
      maxX = Math.max(maxX, c.x + halfX);
      minZ = Math.min(minZ, c.z - halfZ);
      maxZ = Math.max(maxZ, c.z + halfZ);
      minBottomY = Math.min(minBottomY, c.y - halfY);
      maxTopY = Math.max(maxTopY, c.y + halfY);
      return c;
    });

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const liftY = -minBottomY + 0.04;
    const DRIVE_SCALE = 1.28;
    this.bodyTilt.scale.setScalar(DRIVE_SCALE);
    this.radius = Math.min(5.2, Math.max(2.7, Math.max(maxX - minX, maxZ - minZ) * 0.42 * DRIVE_SCALE));
    this.frontZ = Math.max(2.3, (maxZ - cz) * DRIVE_SCALE);
    this.roofY = Math.max(2.6, (maxTopY + liftY) * DRIVE_SCALE);

    blueprint.bricks.forEach((brickData, i) => {
      const part = PARTS_MAP[brickData.partId];
      const c = centers[i];
      const localPos = new THREE.Vector3(c.x - cx, c.y + liftY, c.z - cz);

      const mesh = createBrickMesh(brickData.partId, brickData.color);
      mesh.rotation.y = (brickData.rot * Math.PI) / 2;

      if (part.isWheel) {
        const pivot = new THREE.Group();
        pivot.position.copy(localPos);
        pivot.add(mesh);
        this.bodyTilt.add(pivot);
        const spinMesh = mesh.getObjectByName('wheel_spin') || mesh;
        this.wheels.push({
          pivot,
          spinMesh,
          isFront: brickData.partId !== 'tank_tread' && localPos.z > 0.2,
          radius: part.wheelRadius ?? 0.85,
        });
        this.bricks.push({
          data: brickData,
          mesh: pivot,
          localPos,
          isCore: true,
          isWheel: true,
          detached: false,
        });
      } else {
        mesh.position.copy(localPos);
        this.bodyTilt.add(mesh);
        if (part.isThruster) {
          const flame = mesh.getObjectByName('thruster_flame');
          if (flame) {
            this.thrusters.push({ flame, localPos });
          }
        }
        const saw = mesh.getObjectByName('saw_spin');
        if (saw) {
          this.saws.push(saw);
        }
        const isCore = brickData.gy <= 0 && part.category === 'chassis';
        this.bricks.push({
          data: brickData,
          mesh,
          localPos,
          isCore,
          isWheel: false,
          detached: false,
        });
      }
    });

    // Dynamic cyan plasma glow point light at rear when boosting
    if (enableBoostLight) {
      this.boostLight = new THREE.PointLight(0x38e8ff, 0, 14, 1.8);
      this.boostLight.position.set(0, 1.4, -(maxZ - minZ) * 0.5 - 1.1);
      this.bodyTilt.add(this.boostLight);
    }
  }

  private createNameplate(label: string, accent: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 72;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = 'rgba(15, 20, 28, 0.82)';
    ctx.beginPath();
    ctx.roundRect(10, 10, 300, 52, 14);
    ctx.fill();

    ctx.fillStyle = accent;
    ctx.fillRect(18, 18, 10, 36);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 24px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 40, 36);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(4.8, 1.1, 1);
    return sprite;
  }

  public getBricksRemaining(): number {
    let count = 0;
    for (const b of this.bricks) {
      if (!b.detached) count++;
    }
    return count;
  }

  public getBricksTotal(): number {
    return this.bricks.length;
  }

  public getSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  public getForwardVector(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  public getRightVector(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  public syncTransform(): void {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
  }

  public updatePhysics(
    dt: number,
    input: ControlInput,
    groundHeight: number,
    debris: DebrisSystem,
    canDrive: boolean
  ): void {
    if (this.damageCooldown > 0) this.damageCooldown -= dt;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 3.5);

    if (this.wrecked) {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.2));
      this.position.addScaledVector(this.velocity, dt);
      this.position.y = Math.max(groundHeight, this.position.y);
      this.syncTransform();
      return;
    }

    const fwd = this.getForwardVector();
    const right = this.getRightVector();

    let fwdSpeed = this.velocity.dot(fwd);
    let latSpeed = this.velocity.dot(right);

    // Boost logic
    const wantsBoost = canDrive && input.boost && this.boost > 2 && input.throttle >= -0.1;
    this.isBoosting = wantsBoost;
    if (wantsBoost) {
      this.boost = Math.max(0, this.boost - dt * 30);
    } else {
      const recharge = this.isDrifting ? 22 : 8.5;
      this.boost = Math.min(100, this.boost + dt * recharge);
    }

    const maxSpd = this.stats.physMaxSpeed + (this.isBoosting ? this.stats.physBoostPower : 0);
    const accel = this.stats.physAccel + (this.isBoosting ? 12 : 0);

    if (canDrive) {
      if (input.throttle > 0.05) {
        fwdSpeed += input.throttle * accel * dt;
      } else if (input.throttle < -0.05) {
        if (fwdSpeed > 2) {
          // Strong responsive braking
          fwdSpeed += input.throttle * accel * 2.0 * dt;
        } else {
          // Reverse
          fwdSpeed += input.throttle * accel * 0.78 * dt;
        }
      } else {
        // Natural rolling resistance so releasing gas settles speed smoothly
        fwdSpeed *= Math.max(0, 1 - dt * 1.65);
      }

      if (this.isBoosting && fwdSpeed < maxSpd) {
        fwdSpeed += 12 * dt;
      }

      // Speed caps
      if (fwdSpeed > maxSpd) fwdSpeed = THREE.MathUtils.lerp(fwdSpeed, maxSpd, dt * 5.2);
      if (fwdSpeed < -16) fwdSpeed = -16;

      // Steering with responsive low-speed agility and high-speed stability
      const speedFactor = Math.min(1, Math.abs(fwdSpeed) / 4.8);
      const highSpeedDamp = 1 - Math.min(0.28, Math.max(0, (Math.abs(fwdSpeed) - 32) * 0.012));
      const steerDir = fwdSpeed >= -0.5 ? 1 : -1;
      const drifting = input.handbrake && Math.abs(fwdSpeed) > 12 && Math.abs(input.steer) > 0.15;
      this.isDrifting = drifting;

      const turnMult = (drifting ? 1.32 : 1.0) * highSpeedDamp;
      const targetYaw = input.steer * this.stats.physTurnRate * turnMult * speedFactor * steerDir;
      this.yawRate = THREE.MathUtils.lerp(this.yawRate, targetYaw, dt * 12);
      if (this.grounded) {
        this.heading += this.yawRate * dt;
      } else {
        this.heading += this.yawRate * 0.25 * dt;
      }
    } else {
      fwdSpeed *= Math.max(0, 1 - dt * 5);
      this.isDrifting = false;
      this.isBoosting = false;
    }

    // Re-evaluate axes after heading update & apply lateral tire grip
    const newFwd = this.getForwardVector();
    const newRight = this.getRightVector();
    const grip = this.grounded ? (this.isDrifting ? this.stats.physGrip * 0.4 : this.stats.physGrip) : 0.8;
    latSpeed *= Math.max(0, 1 - grip * dt);

    this.velocity.copy(newFwd).multiplyScalar(fwdSpeed).addScaledVector(newRight, latSpeed);

    // Move horizontally
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
    this.justLandedAirTime = 0;
    this.justHopped = false;

    // Hydraulic Jump / Hop trigger!
    if (canDrive && input.jump && this.grounded && this.jumpCooldown <= 0) {
      this.vy = this.stats.physJumpImpulse;
      this.grounded = false;
      this.jumpCooldown = 0.85;
      this.justHopped = true;
      debris.spawnSparks(this.position.clone().add(new THREE.Vector3(0, 0.3, 0)), 8);
    }

    // Weighty snappy arcade gravity (42.0) — exciting air without moon-floating!
    if (this.position.y > groundHeight + 0.05 || this.vy > 0) {
      this.airTime += dt;
      this.vy -= 42.0 * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= groundHeight) {
        this.position.y = groundHeight;
        if (this.airTime > 0.45) {
          this.justLandedAirTime = this.airTime;
          this.boost = Math.min(100, this.boost + Math.min(40, this.airTime * 22));
          debris.spawnSmoke(this.position, 6);
        }
        this.airTime = 0;
        this.vy = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else {
      this.position.y = groundHeight;
      this.grounded = true;
      this.airTime = 0;
    }

    // Dynamic body roll & pitch (lively arcade suspension + mid-air nose angle!)
    const targetPitch = !this.grounded
      ? THREE.MathUtils.clamp(-this.vy * 0.018, -0.32, 0.28)
      : this.isBoosting
        ? -0.085
        : -input.throttle * 0.038;
    const targetRoll = -input.steer * Math.min(1, Math.abs(fwdSpeed) / 28) * (this.isDrifting ? 0.14 : 0.07);
    this.bodyTilt.rotation.x = THREE.MathUtils.lerp(this.bodyTilt.rotation.x, targetPitch, dt * 8);
    this.bodyTilt.rotation.z = THREE.MathUtils.lerp(this.bodyTilt.rotation.z, targetRoll, dt * 8);

    // Wheel rotation & front wheel steering
    this.currentSteerVisual = THREE.MathUtils.lerp(this.currentSteerVisual, input.steer * 0.44, dt * 12);
    for (const w of this.wheels) {
      if (w.isFront) {
        w.pivot.rotation.y = this.currentSteerVisual;
      }
      w.spinMesh.rotation.x += (fwdSpeed / Math.max(0.5, w.radius)) * dt;
    }

    // Spin front demolition buzzsaw blades at ferocious RPM!
    const sawRpm = this.isBoosting ? 28 : 14 + Math.abs(fwdSpeed) * 0.25;
    for (const saw of this.saws) {
      saw.rotation.y += sawRpm * dt;
    }

    // Thruster flames & exhaust particles (matching Screenshot 3's glowing blue jets!)
    const flicker = 0.85 + Math.random() * 0.38;
    for (const th of this.thrusters) {
      if (this.isBoosting) {
        th.flame.visible = true;
        th.flame.scale.set(1.18 * flicker, 1.18 * flicker, 1.65 * flicker);
      } else if (canDrive && input.throttle > 0.2) {
        th.flame.visible = true;
        th.flame.scale.set(0.55, 0.55, 0.35 * flicker);
      } else {
        th.flame.visible = false;
      }
    }

    if (this.boostLight) {
      this.boostLight.intensity = this.isBoosting ? 5.5 * flicker : 0;
    }

    // Boost plasma particles
    if (this.isBoosting) {
      this.boostParticleTimer += dt;
      if (this.boostParticleTimer > 0.025) {
        this.boostParticleTimer = 0;
        const backVel = newFwd.clone().multiplyScalar(-18);
        if (this.thrusters.length > 0) {
          for (const th of this.thrusters) {
            const worldNozzle = th.localPos.clone().add(new THREE.Vector3(0, 0, -1.0));
            this.bodyTilt.localToWorld(worldNozzle);
            debris.spawnBoostParticle(worldNozzle, backVel);
          }
        } else {
          const fallback = this.position.clone().addScaledVector(newFwd, -2.5).add(new THREE.Vector3(0, 1.0, 0));
          debris.spawnBoostParticle(fallback, backVel);
        }
      }
    }

    // Drift tire smoke
    if (this.isDrifting && this.grounded) {
      this.smokeTimer += dt;
      if (this.smokeTimer > 0.045) {
        this.smokeTimer = 0;
        const rear = this.position.clone().addScaledVector(newFwd, -1.8);
        debris.spawnSmoke(rear, 1);
      }
    }

    this.syncTransform();
  }

  /**
   * Applies structural damage and pops real individual bricks off the vehicle nearest the hit point!
   */
  public applyDamage(
    amount: number,
    impactWorldPoint: THREE.Vector3,
    debris: DebrisSystem,
    attacker: DriveVehicle | null = null
  ): boolean {
    if (this.wrecked || amount <= 0) return false;

    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 1.0;
    if (attacker) {
      this.lastHitBy = attacker;
      this.lastHitTime = performance.now();
    }

    debris.spawnSparks(impactWorldPoint, Math.min(20, Math.max(8, Math.round((amount / this.maxHp) * 90))));

    // Convert impact point to local space to knock off nearest outer bricks smoothly across ~10+ hits!
    const localImpact = impactWorldPoint.clone();
    this.bodyTilt.worldToLocal(localImpact);

    const hpRatioLost = amount / Math.max(1, this.maxHp);
    const bricksToShed = Math.min(3, Math.max(1, Math.round(hpRatioLost * 16)));
    const candidates = this.bricks
      .filter((b) => !b.detached && !b.isCore && !b.isWheel)
      .sort((a, b) => a.localPos.distanceToSquared(localImpact) - b.localPos.distanceToSquared(localImpact));

    for (let i = 0; i < Math.min(bricksToShed, candidates.length); i++) {
      this.detachBrick(candidates[i], impactWorldPoint, debris, 1.0);
    }

    if (this.hp <= 0) {
      this.triggerWreckExplosion(debris);
      return true; // newly wrecked!
    }
    return false;
  }

  private detachBrick(
    entry: AttachedBrick,
    impactPoint: THREE.Vector3,
    debris: DebrisSystem,
    forceScale: number
  ): void {
    entry.detached = true;
    entry.mesh.visible = false;

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    entry.mesh.getWorldPosition(worldPos);
    entry.mesh.getWorldQuaternion(worldQuat);

    const ejectDir = worldPos.clone().sub(impactPoint);
    if (ejectDir.lengthSq() < 0.01) {
      ejectDir.set(Math.random() - 0.5, 1, Math.random() - 0.5);
    }
    ejectDir.normalize();
    const vel = ejectDir
      .multiplyScalar((8 + Math.random() * 14) * forceScale)
      .add(new THREE.Vector3(0, (6 + Math.random() * 10) * forceScale, 0))
      .addScaledVector(this.velocity, 0.4);

    debris.spawnDetachedBrick(entry.data, worldPos, worldQuat, vel);
  }

  private triggerWreckExplosion(debris: DebrisSystem): void {
    this.wrecked = true;
    this.isBoosting = false;
    if (this.boostLight) this.boostLight.intensity = 0;
    if (this.nameplateSprite) this.nameplateSprite.visible = false;

    debris.spawnSparks(this.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 34);
    debris.spawnSmoke(this.position.clone().add(new THREE.Vector3(0, 1.2, 0)), 10);

    // Blast all remaining bricks skyward!
    for (const entry of this.bricks) {
      if (!entry.detached) {
        this.detachBrick(entry, this.position, debris, 1.45);
      }
    }
  }

  /** Re-attaches shattered bricks and restores HP (used by Repair Wrench pickups!) */
  public repair(fraction = 0.45): void {
    if (this.wrecked) return;
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * fraction);
    const detached = this.bricks.filter((b) => b.detached);
    const toRestore = Math.ceil(detached.length * Math.min(1, fraction + 0.35));
    for (let i = 0; i < Math.min(toRestore, detached.length); i++) {
      detached[i].detached = false;
      detached[i].mesh.visible = true;
    }
  }
}
