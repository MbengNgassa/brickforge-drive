export type BrickCategory = 'chassis' | 'bricks' | 'cab' | 'wheels' | 'power';

export type BrickPartId =
  | 'plate_4x6'
  | 'plate_2x6'
  | 'plate_2x4'
  | 'plate_2x2'
  | 'plate_1x4'
  | 'tile_2x2'
  | 'brick_2x4'
  | 'brick_2x2'
  | 'brick_1x4'
  | 'brick_1x2'
  | 'brick_1x1'
  | 'slope_2x2'
  | 'slope_2x3'
  | 'fender_1x4'
  | 'windshield_2x4'
  | 'seat_2x2'
  | 'steering_1x2'
  | 'headlight_1x2'
  | 'taillight_1x2'
  | 'spoiler_1x4'
  | 'wheel_street'
  | 'wheel_offroad'
  | 'wheel_monster'
  | 'thruster_jet'
  | 'bumper_ram'
  | 'spike_plow'
  | 'armor_plate'
  | 'turret_blaster'
  | 'exhaust_pipes'
  | 'roll_cage'
  | 'saw_blade'
  | 'bull_horns'
  | 'tank_tread'
  | 'plate_6x8'
  | 'mega_rocket'
  | 'jump_springs';

export interface BrickPartDef {
  id: BrickPartId;
  name: string;
  shortName: string;
  category: BrickCategory;
  /** Width in studs along X when rot=0 */
  w: number;
  /** Height in plates along Y (1 plate = 1/3 brick) */
  h: number;
  /** Depth in studs along Z when rot=0 */
  d: number;
  mass: number;
  hp: number;
  topSpeedBonus: number;
  boostBonus: number;
  gripBonus: number;
  ramBonus: number;
  armorBonus: number;
  isWheel?: boolean;
  wheelRadius?: number;
  isThruster?: boolean;
  isSpring?: boolean;
  isTranslucent?: boolean;
  hasStudsTop?: boolean;
  fixedColor?: string;
}

export interface PlacedBrick {
  uid: string;
  partId: BrickPartId;
  /** Minimum X stud coordinate */
  gx: number;
  /** Minimum Y plate coordinate */
  gy: number;
  /** Minimum Z stud coordinate */
  gz: number;
  /** Rotation around Y in 90-degree increments: 0, 1, 2, 3 */
  rot: 0 | 1 | 2 | 3;
  color: string;
}

export interface VehicleBlueprint {
  id: string;
  name: string;
  tagline: string;
  bricks: PlacedBrick[];
  createdAt?: number;
}

export interface DriverProfile {
  id: string;
  username: string;
  avatar: string;
  accentColor: string;
  activeVehicle: VehicleBlueprint;
  savedVehicles: VehicleBlueprint[];
  totalKos: number;
  totalWins: number;
}

export interface VehicleStats {
  brickCount: number;
  maxBricks: number;
  mass: number;
  wheelCount: number;
  thrusterCount: number;
  springCount: number;
  topSpeed: number; // 0..100 display rating
  acceleration: number; // 0..100 display rating
  handling: number; // 0..100 display rating
  armor: number; // 0..100 display rating
  ramPower: number; // 0..100 display rating
  /** Derived physics parameters */
  physMaxSpeed: number;
  physAccel: number;
  physTurnRate: number;
  physGrip: number;
  physMaxHp: number;
  physRamMultiplier: number;
  physBoostPower: number;
  physJumpImpulse: number;
}

export interface ColorDef {
  id: string;
  name: string;
  hex: string;
  metallic?: boolean;
  translucent?: boolean;
}

export type GameMode = 'garage' | 'race' | 'derby' | 'family' | 'freeroam';

export type BuilderTool = 'place' | 'move' | 'paint' | 'erase';

export type GraphicsQuality = 'ultra' | 'high' | 'balanced';

export interface HudState {
  mode: GameMode;
  speedKmh: number;
  boost: number; // 0..100
  hp: number;
  maxHp: number;
  bricksRemaining: number;
  bricksTotal: number;
  countdown: number; // >0 showing 3,2,1, 0 = GO flash, <0 hidden
  // Race specific
  lap: number;
  totalLaps: number;
  position: number;
  totalRacers: number;
  raceTime: number;
  waypointDist: number;
  // Derby specific
  kos: number;
  aliveCount: number;
  score: number;
  wave: number;
  // Status
  finished: boolean;
  won: boolean;
  finishMessage: string;
  finishSubtext: string;
  eventBanner: string;
  fps: number;
}
