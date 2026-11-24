import type { BrickPartId, PlacedBrick, VehicleBlueprint } from './types';

let uidSeq = 1;
export function makeUid(prefix = 'b'): string {
  return `${prefix}_${uidSeq++}_${Math.random().toString(36).slice(2, 6)}`;
}

function b(
  partId: BrickPartId,
  gx: number,
  gy: number,
  gz: number,
  color: string,
  rot: 0 | 1 | 2 | 3 = 0
): PlacedBrick {
  return { uid: makeUid('bp'), partId, gx, gy, gz, rot, color };
}

export function cloneBlueprint(bp: VehicleBlueprint): VehicleBlueprint {
  return {
    ...bp,
    bricks: bp.bricks.map((item) => ({ ...item, uid: makeUid('cl') })),
  };
}

/**
 * 5 starter vehicles directly inspired by LEGO 2K Drive & the user's reference screenshots.
 * Coordinate system: +Z = front, -Z = rear, +Y = up (in plates), X centered around 0.
 * All bricks sit cleanly on integer stud/plate coordinates with zero overlap.
 */
export const STARTER_BLUEPRINTS: VehicleBlueprint[] = [
  // 1. CANYON BUGGY (Inspired by Screenshot 1: tan plates, white steering cab, red side bumpers, chunky off-road tires!)
  {
    id: 'canyon-buggy',
    name: 'Canyon Buggy',
    tagline: 'Open-top desert off-roader with chunky tread tires & twin boost',
    bricks: [
      // Main chassis floor (y=0)
      b('plate_4x6', -2, 0, -3, '#1d2128'),
      b('plate_4x6', -2, 0, 3, '#1d2128'),
      // Tan top deck plates (y=1)
      b('plate_2x6', -2, 1, 3, '#b6895b'),
      b('plate_2x6', 0, 1, 3, '#b6895b'),
      b('plate_2x4', -2, 1, -1, '#b6895b'),
      b('plate_2x4', 0, 1, -1, '#b6895b'),
      b('plate_2x2', -2, 1, -3, '#b6895b'),
      b('plate_2x2', 0, 1, -3, '#b6895b'),
      // Red side rails
      b('plate_1x4', -3, 1, 0, '#d92626', 1),
      b('plate_1x4', 2, 1, 0, '#d92626', 1),
      // White steering dash & cab pillars (y=2)
      b('brick_1x2', -2, 2, 2, '#f0f3f7'),
      b('brick_1x2', 0, 2, 2, '#f0f3f7'),
      b('steering_1x2', -1, 2, 1, '#f0f3f7'),
      b('seat_2x2', -1, 2, -2, '#b6895b'),
      // Nose grill & bumper
      b('bumper_ram', -2, 1, 9, '#aeb6c2'),
      b('headlight_1x2', -2, 2, 8, '#f0f3f7'),
      b('headlight_1x2', 0, 2, 8, '#f0f3f7'),
      b('slope_2x2', -2, 2, 6, '#d92626'),
      b('slope_2x2', 0, 2, 6, '#d92626'),
      // Rear tail & dual plasma thrusters
      b('taillight_1x2', -1, 2, -3, '#d92626'),
      b('thruster_jet', -2, 2, -5, '#4b5361'),
      b('thruster_jet', 0, 2, -5, '#4b5361'),
      b('spoiler_1x4', -2, 4, -3, '#d92626'),
      // 4 Chunky Off-Road Wheels
      b('wheel_offroad', -4, -1, 5, '#aeb6c2'),
      b('wheel_offroad', 2, -1, 5, '#aeb6c2'),
      b('wheel_offroad', -4, -1, -2, '#aeb6c2'),
      b('wheel_offroad', 2, -1, -2, '#aeb6c2'),
    ],
  },

  // 2. BLUE HAULER (Inspired by Screenshot 2: bold cobalt blue brick van/truck with glossy translucent windshield & gray bumper)
  {
    id: 'blue-hauler',
    name: 'Blue Hauler',
    tagline: 'Sturdy cobalt brick truck with panoramic glass cab & high torque',
    bricks: [
      // Chassis base
      b('plate_4x6', -2, 0, -4, '#aeb6c2'),
      b('plate_4x6', -2, 0, 2, '#aeb6c2'),
      // Front gray bumper & headlights
      b('bumper_ram', -2, 0, 8, '#aeb6c2'),
      b('headlight_1x2', -2, 2, 8, '#1d5fd6'),
      b('headlight_1x2', 0, 2, 8, '#1d5fd6'),
      // Blue front hood
      b('brick_2x2', -2, 1, 6, '#1d5fd6'),
      b('brick_2x2', 0, 1, 6, '#1d5fd6'),
      b('tile_2x2', -2, 4, 6, '#1d5fd6'),
      b('tile_2x2', 0, 4, 6, '#1d5fd6'),
      // Lower cab body
      b('brick_2x4', -2, 1, 2, '#1d5fd6'),
      b('brick_2x4', 0, 1, 2, '#1d5fd6'),
      b('brick_2x4', -2, 1, -2, '#1d5fd6'),
      b('brick_2x4', 0, 1, -2, '#1d5fd6'),
      b('brick_1x4', -2, 1, -4, '#1d5fd6'),
      // Panoramic translucent windshield (y=4..7, z=3..4) + cab walls (y=4..6)
      b('windshield_2x4', -2, 4, 3, '#55ccff'),
      b('brick_1x4', -2, 4, -1, '#1d5fd6', 1),
      b('brick_1x4', 1, 4, -1, '#1d5fd6', 1),
      b('brick_1x4', -2, 4, -3, '#1d5fd6'),
      b('seat_2x2', -1, 4, 0, '#4b5361'),
      // Upper cab trim plates (y=7) flush with top of windshield
      b('plate_1x4', -2, 7, -1, '#1d5fd6', 1),
      b('plate_1x4', 1, 7, -1, '#1d5fd6', 1),
      b('plate_1x4', -2, 7, -3, '#1d5fd6'),
      // Iconic black roof cap (y=8)
      b('plate_4x6', -2, 8, -3, '#1d2128'),
      // Rear taillights & dual boosters
      b('taillight_1x2', -2, 4, -4, '#d92626'),
      b('taillight_1x2', 0, 4, -4, '#d92626'),
      b('thruster_jet', -2, 1, -6, '#4b5361'),
      b('thruster_jet', 0, 1, -6, '#4b5361'),
      // Street Sport Wheels
      b('wheel_street', -4, -1, 4, '#d4dde8'),
      b('wheel_street', 2, -1, 4, '#d4dde8'),
      b('wheel_street', -4, -1, -3, '#d4dde8'),
      b('wheel_street', 2, -1, -3, '#d4dde8'),
    ],
  },

  // 3. TURBO INTERCEPTOR (Inspired by Screenshot 3: ultra-fast canyon racer with huge glowing twin plasma boosters!)
  {
    id: 'turbo-interceptor',
    name: 'Turbo Interceptor',
    tagline: 'Aerodynamic canyon speedster packing quad plasma jet thrusters',
    bricks: [
      // Sleek long chassis
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      b('plate_2x4', -1, 0, 8, '#1d5fd6'),
      // Sharp aero nose
      b('slope_2x3', -2, 1, 6, '#1d5fd6'),
      b('slope_2x3', 0, 1, 6, '#1d5fd6'),
      b('headlight_1x2', -1, 1, 9, '#f4be17'),
      // Side aero fenders elevated cleanly above the wheel arches (y=2)
      b('fender_1x4', -3, 2, 3, '#f0f3f7'),
      b('fender_1x4', 2, 2, 3, '#f0f3f7'),
      b('fender_1x4', -3, 2, -4, '#f0f3f7'),
      b('fender_1x4', 2, 2, -4, '#f0f3f7'),
      // Low-slung cockpit
      b('plate_2x4', -1, 1, 1, '#f4be17'),
      b('steering_1x2', -1, 2, 3, '#1d2128'),
      b('seat_2x2', -1, 2, 1, '#d92626'),
      b('windshield_2x4', -2, 2, 4, '#55ccff'),
      // Rear engine deck
      b('brick_2x4', -2, 1, -4, '#1d5fd6'),
      b('brick_2x4', 0, 1, -4, '#1d5fd6'),
      b('tile_2x2', -1, 4, -2, '#f4be17'),
      b('spoiler_1x4', -2, 4, -4, '#d92626'),
      b('taillight_1x2', -1, 3, -5, '#ff3344'),
      // Quad Plasma Thrusters (2 central + 2 outboard pods like Screenshot 3!)
      b('thruster_jet', -2, 1, -6, '#4b5361'),
      b('thruster_jet', 0, 1, -6, '#4b5361'),
      b('thruster_jet', -4, 2, -6, '#1d5fd6'),
      b('thruster_jet', 2, 2, -6, '#1d5fd6'),
      // High-grip Street Wheels
      b('wheel_street', -4, -1, 5, '#e3b23c'),
      b('wheel_street', 2, -1, 5, '#e3b23c'),
      b('wheel_street', -4, -1, -3, '#e3b23c'),
      b('wheel_street', 2, -1, -3, '#e3b23c'),
    ],
  },

  // 4. IRON CRUSHER (Demolition Derby juggernaut with spike plow, titanium armor & monster wheels!)
  {
    id: 'iron-crusher',
    name: 'Iron Crusher',
    tagline: 'Armored demolition beast with front spike plow & monster tires',
    bricks: [
      // Heavy chassis
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      // Front demolition spike plow!
      b('spike_plow', -2, 0, 8, '#d4dde8'),
      b('bumper_ram', -2, 0, -5, '#4b5361'),
      // Armored hood & hazard stripes
      b('armor_plate', -2, 1, 5, '#f4be17'),
      b('armor_plate', 0, 1, 5, '#1d2128'),
      b('headlight_1x2', -2, 4, 6, '#f4be17'),
      b('headlight_1x2', 0, 4, 6, '#f4be17'),
      // Side titanium armor skirt
      b('armor_plate', -2, 1, 2, '#4b5361'),
      b('armor_plate', 0, 1, 2, '#4b5361'),
      b('armor_plate', -2, 1, -1, '#1d2128'),
      b('armor_plate', 0, 1, -1, '#1d2128'),
      b('armor_plate', -2, 1, -4, '#f4be17'),
      b('armor_plate', 0, 1, -4, '#f4be17'),
      // Reinforced bunker cab (windshield y=4..7, z=2..3)
      b('windshield_2x4', -2, 4, 2, '#ff3344'),
      b('brick_1x4', -2, 4, -2, '#1d2128', 1),
      b('brick_1x4', 1, 4, -2, '#1d2128', 1),
      b('brick_1x4', -2, 4, -3, '#1d2128'),
      b('plate_1x4', -2, 7, -2, '#4b5361', 1),
      b('plate_1x4', 1, 7, -2, '#4b5361', 1),
      b('plate_4x6', -2, 8, -3, '#4b5361'),
      // Rear ramming boost jets
      b('thruster_jet', -2, 4, -6, '#ee6a18'),
      b('thruster_jet', 0, 4, -6, '#ee6a18'),
      // Monster Crusher Wheels
      b('wheel_monster', -4, -1, 4, '#f4be17'),
      b('wheel_monster', 2, -1, 4, '#f4be17'),
      b('wheel_monster', -4, -1, -3, '#f4be17'),
      b('wheel_monster', 2, -1, -3, '#f4be17'),
    ],
  },

  // 5. TEAL CRUISER (Inspired by the 1950s teal/white blueprint in Screenshot 1!)
  {
    id: 'teal-cruiser',
    name: 'Teal Classic',
    tagline: 'Retro 1950s finned roadster in classic teal, chrome & cream',
    bricks: [
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      // Chrome front bumper & headlights
      b('bumper_ram', -2, 0, 8, '#d4dde8'),
      b('headlight_1x2', -2, 2, 8, '#f0f3f7'),
      b('headlight_1x2', 0, 2, 8, '#f0f3f7'),
      // Teal hood
      b('brick_2x4', -2, 1, 4, '#168f8b'),
      b('brick_2x4', 0, 1, 4, '#168f8b'),
      b('tile_2x2', -1, 4, 5, '#168f8b'),
      // Open convertible cabin with tan seat & white trim
      b('brick_1x4', -2, 1, 0, '#f0f3f7', 1),
      b('brick_1x4', 1, 1, 0, '#f0f3f7', 1),
      b('steering_1x2', -1, 1, 3, '#f0f3f7'),
      b('seat_2x2', -1, 1, 0, '#b6895b'),
      b('windshield_2x4', -2, 4, 3, '#55ccff'),
      // Iconic white tailfins + teal trunk
      b('brick_2x4', -2, 1, -4, '#168f8b'),
      b('brick_2x4', 0, 1, -4, '#168f8b'),
      b('slope_2x3', -2, 4, -4, '#f0f3f7', 2),
      b('slope_2x3', 0, 4, -4, '#f0f3f7', 2),
      b('taillight_1x2', -1, 3, -5, '#ff3344'),
      b('thruster_jet', -1, 1, -6, '#d4dde8'),
      // Street Sport Wheels
      b('wheel_street', -4, -1, 5, '#f0f3f7'),
      b('wheel_street', 2, -1, 5, '#f0f3f7'),
      b('wheel_street', -4, -1, -3, '#f0f3f7'),
      b('wheel_street', 2, -1, -3, '#f0f3f7'),
    ],
  },

  // 6. DOOMSDAY TANK (Heavy crawler tank on Armored Tank Treads with roof Twin Cannon Turret & front Spike Plow!)
  {
    id: 'doomsday-tank',
    name: 'Doomsday Tank',
    tagline: 'Unstoppable armored crawler on tank treads with twin cannon war turret',
    bricks: [
      // Heavy hull chassis
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      // Front demolition spike plow & rear ram bumper
      b('spike_plow', -2, 0, 8, '#4b5361'),
      b('bumper_ram', -2, 0, -5, '#1d2128'),
      // Full armored olive-green & obsidian glacis hull
      b('armor_plate', -2, 1, 5, '#1d7a42'),
      b('armor_plate', 0, 1, 5, '#1d7a42'),
      b('armor_plate', -2, 1, 2, '#4b5361'),
      b('armor_plate', 0, 1, 2, '#4b5361'),
      b('armor_plate', -2, 1, -1, '#1d7a42'),
      b('armor_plate', 0, 1, -1, '#1d7a42'),
      b('armor_plate', -2, 1, -4, '#1d2128'),
      b('armor_plate', 0, 1, -4, '#1d2128'),
      // Armored sloped front & headlights
      b('slope_2x2', -2, 4, 6, '#1d7a42'),
      b('slope_2x2', 0, 4, 6, '#1d7a42'),
      b('headlight_1x2', -1, 4, 5, '#f4be17'),
      // Upper bunker deck + Roof Twin Cannon War Turret!
      b('plate_4x6', -2, 4, -2, '#4b5361'),
      b('turret_blaster', -1, 5, 0, '#1d7a42'),
      b('exhaust_pipes', -2, 5, -4, '#1d2128'),
      b('exhaust_pipes', 1, 5, -4, '#1d2128'),
      // Twin Plasma Thrusters for terrifying tank ram bursts!
      b('thruster_jet', -2, 2, -6, '#4b5361'),
      b('thruster_jet', 0, 2, -6, '#4b5361'),
      // Quad Armored Tank Tread Pods!
      b('tank_tread', -4, -1, 3, '#f4be17'),
      b('tank_tread', 2, -1, 3, '#f4be17'),
      b('tank_tread', -4, -1, -3, '#f4be17'),
      b('tank_tread', 2, -1, -3, '#f4be17'),
    ],
  },

  // 7. SAWBLADE WAR-RIG (Apocalyptic Mad-Max demolition shredder with SPINNING FRONT BUZZSAW & chrome V8 stacks!)
  {
    id: 'sawblade-warrig',
    name: 'Sawblade War-Rig',
    tagline: 'Apocalyptic shredder packing a spinning front buzzsaw & V8 stacks',
    bricks: [
      // Reinforced low chassis
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      // Spinning Shredder Buzzsaw right on the nose!
      b('saw_blade', -2, 0, 8, '#d92626'),
      b('bumper_ram', -2, 0, -5, '#4b5361'),
      // Matte black & crimson war body
      b('armor_plate', -2, 1, 5, '#1d2128'),
      b('armor_plate', 0, 1, 5, '#1d2128'),
      b('headlight_1x2', -2, 4, 6, '#ee6a18'),
      b('headlight_1x2', 0, 4, 6, '#ee6a18'),
      b('brick_2x4', -2, 1, 1, '#d92626'),
      b('brick_2x4', 0, 1, 1, '#d92626'),
      b('brick_2x4', -2, 1, -4, '#1d2128'),
      b('brick_2x4', 0, 1, -4, '#1d2128'),
      // Roll cage cockpit + glowing red glass + chrome V8 side exhaust stacks!
      b('windshield_2x4', -2, 4, 3, '#ff3344'),
      b('roll_cage', -2, 4, 0, '#d4dde8'),
      b('exhaust_pipes', -3, 2, 1, '#1d2128'),
      b('exhaust_pipes', 2, 2, 1, '#1d2128'),
      // Rear spoiler & dual plasma thrusters
      b('spoiler_1x4', -2, 4, -4, '#d92626'),
      b('thruster_jet', -2, 2, -6, '#ee6a18'),
      b('thruster_jet', 0, 2, -6, '#ee6a18'),
      // Monster Crusher Wheels
      b('wheel_monster', -4, -1, 4, '#d92626'),
      b('wheel_monster', 2, -1, 4, '#d92626'),
      b('wheel_monster', -4, -1, -3, '#d92626'),
      b('wheel_monster', 2, -1, -3, '#d92626'),
    ],
  },

  // 8. MONSTER RAMPAGE 6x6 (Colossal 6-wheeled lifted monster truck with Chrome Bull Horns & V8 stacks!)
  {
    id: 'monster-rampage-6x6',
    name: 'Monster Rampage 6×6',
    tagline: 'Colossal 6-wheel lifted crusher with bull-horn ram & twin stacks',
    bricks: [
      // Extended heavy chassis for 6 giant monster tires!
      b('plate_4x6', -2, 0, -5, '#1d2128'),
      b('plate_4x6', -2, 0, 1, '#1d2128'),
      b('plate_2x4', -1, 0, 7, '#1d2128'),
      // Chrome Bull-Horn front ram!
      b('bull_horns', -2, 1, 8, '#d92626'),
      b('headlight_1x2', -2, 3, 7, '#f4be17'),
      b('headlight_1x2', 0, 3, 7, '#f4be17'),
      // Lifted red & gold truck body
      b('brick_2x4', -2, 1, 3, '#d92626'),
      b('brick_2x4', 0, 1, 3, '#d92626'),
      b('brick_2x4', -2, 1, -1, '#e3b23c'),
      b('brick_2x4', 0, 1, -1, '#e3b23c'),
      b('brick_2x4', -2, 1, -5, '#d92626'),
      b('brick_2x4', 0, 1, -5, '#d92626'),
      // Tall cab with translucent blue glass, roll cage & exhaust stacks
      b('windshield_2x4', -2, 4, 3, '#55ccff'),
      b('roll_cage', -2, 4, 0, '#e3b23c'),
      b('exhaust_pipes', -2, 4, -3, '#d4dde8'),
      b('exhaust_pipes', 1, 4, -3, '#d4dde8'),
      b('thruster_jet', -2, 1, -7, '#4b5361'),
      b('thruster_jet', 0, 1, -7, '#4b5361'),
      // SIX Monster Crusher Wheels (3 axles!)
      b('wheel_monster', -4, -1, 5, '#e3b23c'),
      b('wheel_monster', 2, -1, 5, '#e3b23c'),
      b('wheel_monster', -4, -1, 0, '#e3b23c'),
      b('wheel_monster', 2, -1, 0, '#e3b23c'),
      b('wheel_monster', -4, -1, -5, '#e3b23c'),
      b('wheel_monster', 2, -1, -5, '#e3b23c'),
    ],
  },

  // 9. APEX HYPERCAR (Ultra-low widebody acid-lime & obsidian track monster with quad plasma thrusters!)
  {
    id: 'apex-hypercar',
    name: 'Apex Hypercar',
    tagline: 'Razor-low widebody track weapon with quad jets & maximum downforce',
    bricks: [
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      b('plate_2x4', -1, 0, 8, '#6ec41d'),
      // Low razor nose & LED strip
      b('slope_2x3', -2, 1, 6, '#1d2128'),
      b('slope_2x3', 0, 1, 6, '#1d2128'),
      b('headlight_1x2', -1, 1, 9, '#6ec41d'),
      // Sleek cockpit & glass canopy
      b('windshield_2x4', -2, 1, 4, '#55ccff'),
      b('seat_2x2', -1, 1, 1, '#1d2128'),
      b('steering_1x2', -1, 1, 3, '#6ec41d'),
      // Widebody aero fenders
      b('fender_1x4', -3, 2, 3, '#6ec41d'),
      b('fender_1x4', 2, 2, 3, '#6ec41d'),
      b('fender_1x4', -3, 2, -4, '#6ec41d'),
      b('fender_1x4', 2, 2, -4, '#6ec41d'),
      // Rear V12 deck + towering GT wing + quad jets
      b('brick_2x4', -2, 1, -4, '#1d2128'),
      b('brick_2x4', 0, 1, -4, '#1d2128'),
      b('tile_2x2', -1, 4, -2, '#6ec41d'),
      b('spoiler_1x4', -2, 4, -4, '#6ec41d'),
      b('taillight_1x2', -1, 3, -5, '#ff3344'),
      b('thruster_jet', -2, 1, -6, '#1d2128'),
      b('thruster_jet', 0, 1, -6, '#1d2128'),
      b('thruster_jet', -4, 2, -6, '#6ec41d'),
      b('thruster_jet', 2, 2, -6, '#6ec41d'),
      // Low-profile Street Slicks
      b('wheel_street', -4, -1, 5, '#6ec41d'),
      b('wheel_street', 2, -1, 5, '#6ec41d'),
      b('wheel_street', -4, -1, -3, '#6ec41d'),
      b('wheel_street', 2, -1, -3, '#6ec41d'),
    ],
  },

  // 10. TROPHY BAJA STRIKER (High-flying desert rally trophy truck with roll cage, lightbar & wide off-road stance!)
  {
    id: 'baja-striker',
    name: 'Trophy Baja Striker',
    tagline: 'High-flying desert trophy truck built for mega-jumps & high-speed slides',
    bricks: [
      b('plate_4x6', -2, 0, -4, '#1d2128'),
      b('plate_4x6', -2, 0, 2, '#1d2128'),
      // Heavy tubular desert bumper & headlights
      b('bumper_ram', -2, 0, 8, '#f0f3f7'),
      b('headlight_1x2', -2, 2, 8, '#ee6a18'),
      b('headlight_1x2', 0, 2, 8, '#ee6a18'),
      // Sunset orange & white rally livery body
      b('slope_2x2', -2, 1, 6, '#ee6a18'),
      b('slope_2x2', 0, 1, 6, '#ee6a18'),
      b('brick_2x4', -2, 1, 2, '#f0f3f7'),
      b('brick_2x4', 0, 1, 2, '#f0f3f7'),
      b('brick_2x4', -2, 1, -4, '#ee6a18'),
      b('brick_2x4', 0, 1, -4, '#ee6a18'),
      // Wide off-road fenders
      b('fender_1x4', -3, 2, 3, '#ee6a18'),
      b('fender_1x4', 2, 2, 3, '#ee6a18'),
      b('fender_1x4', -3, 2, -4, '#ee6a18'),
      b('fender_1x4', 2, 2, -4, '#ee6a18'),
      // Baja windshield + external white roll cage + roof rally lights!
      b('windshield_2x4', -2, 4, 3, '#55ccff'),
      b('roll_cage', -2, 4, 0, '#f0f3f7'),
      b('headlight_1x2', -1, 7, 1, '#f4be17'),
      b('spoiler_1x4', -2, 4, -4, '#1d2128'),
      b('thruster_jet', -2, 1, -6, '#4b5361'),
      b('thruster_jet', 0, 1, -6, '#4b5361'),
      // Chunky Off-Road Rally Tires
      b('wheel_offroad', -4, -1, 5, '#f0f3f7'),
      b('wheel_offroad', 2, -1, 5, '#f0f3f7'),
      b('wheel_offroad', -4, -1, -3, '#f0f3f7'),
      b('wheel_offroad', 2, -1, -3, '#f0f3f7'),
    ],
  },
];

export const AI_RACER_PROFILES = [
  { name: 'Sawblade Sid', blueprintId: 'sawblade-warrig', tint: '#d92626' },
  { name: 'Commander Rex', blueprintId: 'doomsday-tank', tint: '#1d7a42' },
  { name: 'Rampage Rick', blueprintId: 'monster-rampage-6x6', tint: '#e3b23c' },
  { name: 'Apex Nova', blueprintId: 'apex-hypercar', tint: '#6ec41d' },
  { name: 'Vinny Unleaded', blueprintId: 'turbo-interceptor', tint: '#ee6a18' },
  { name: 'Baja Blaze', blueprintId: 'baja-striker', tint: '#f4be17' },
  { name: 'Crusher Carl', blueprintId: 'iron-crusher', tint: '#ff3344' },
  { name: 'Larry Leadfoot', blueprintId: 'canyon-buggy', tint: '#38bdf8' },
];
