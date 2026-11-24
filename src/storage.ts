import { STARTER_BLUEPRINTS, cloneBlueprint, makeUid } from './blueprints';
import type { DriverProfile, VehicleBlueprint } from './types';

const PROFILES_KEY = 'brickforge_driver_profiles_v2';
const ACTIVE_PROFILE_ID_KEY = 'brickforge_active_profile_id_v2';
const LEGACY_ACTIVE_VEHICLE_KEY = 'brickforge_active_vehicle_v1';
const LEGACY_CUSTOM_SLOTS_KEY = 'brickforge_saved_vehicles_v1';

export const DRIVER_AVATARS = ['🦁', '🦊', '🦖', '🚀', '⚡', '🐉', '🤖', '🔥', '👑', '🦈'];
export const DRIVER_COLORS = ['#d92626', '#1d5fd6', '#f4be17', '#6ec41d', '#ee6a18', '#38bdf8'];

function persistProfiles(profiles: DriverProfile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // ignore storage quota errors
  }
}

export function loadProfiles(): DriverProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DriverProfile[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback below
  }

  // Migrate any legacy build from v1 into Player 1's garage cleanly!
  let legacyActive: VehicleBlueprint | null = null;
  let legacySaved: VehicleBlueprint[] = [];
  try {
    const aRaw = localStorage.getItem(LEGACY_ACTIVE_VEHICLE_KEY);
    if (aRaw) {
      const p = JSON.parse(aRaw) as VehicleBlueprint;
      if (p && Array.isArray(p.bricks) && p.bricks.length > 0) legacyActive = p;
    }
    const sRaw = localStorage.getItem(LEGACY_CUSTOM_SLOTS_KEY);
    if (sRaw) {
      const arr = JSON.parse(sRaw) as VehicleBlueprint[];
      if (Array.isArray(arr)) legacySaved = arr;
    }
  } catch {
    // ignore
  }

  const starter1: DriverProfile = {
    id: 'driver_1',
    username: 'Driver 1',
    avatar: '🦁',
    accentColor: '#f4be17',
    activeVehicle: legacyActive || cloneBlueprint(STARTER_BLUEPRINTS[10]), // Titan Fortress!
    savedVehicles: legacySaved,
    totalKos: 0,
    totalWins: 0,
  };

  const starter2: DriverProfile = {
    id: 'driver_2',
    username: 'Driver 2',
    avatar: '🦖',
    accentColor: '#d92626',
    activeVehicle: cloneBlueprint(STARTER_BLUEPRINTS[13]), // Giga Shredder Boss!
    savedVehicles: [],
    totalKos: 0,
    totalWins: 0,
  };

  const initial = [starter1, starter2];
  persistProfiles(initial);
  setActiveProfileId(starter1.id);
  return initial;
}

export function getActiveProfileId(): string {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_ID_KEY) || 'driver_1';
  } catch {
    return 'driver_1';
  }
}

export function setActiveProfileId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id);
  } catch {
    // ignore
  }
}

export function getActiveProfile(): DriverProfile {
  const profiles = loadProfiles();
  const id = getActiveProfileId();
  return profiles.find((p) => p.id === id) || profiles[0];
}

export function createDriverProfile(username: string, avatar: string, accentColor: string): DriverProfile {
  const profiles = loadProfiles();
  const pickBp = STARTER_BLUEPRINTS[10 + (profiles.length % 4)] || STARTER_BLUEPRINTS[0];
  const created: DriverProfile = {
    id: makeUid('driver'),
    username: username.trim().slice(0, 18) || `Driver ${profiles.length + 1}`,
    avatar: avatar || DRIVER_AVATARS[profiles.length % DRIVER_AVATARS.length],
    accentColor: accentColor || DRIVER_COLORS[profiles.length % DRIVER_COLORS.length],
    activeVehicle: cloneBlueprint(pickBp),
    savedVehicles: [],
    totalKos: 0,
    totalWins: 0,
  };
  profiles.push(created);
  persistProfiles(profiles);
  setActiveProfileId(created.id);
  return created;
}

export function updateDriverProfile(updated: DriverProfile): DriverProfile[] {
  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === updated.id);
  if (idx >= 0) {
    profiles[idx] = updated;
  } else {
    profiles.push(updated);
  }
  persistProfiles(profiles);
  return profiles;
}

export function deleteDriverProfile(id: string): DriverProfile[] {
  let profiles = loadProfiles();
  if (profiles.length <= 1) return profiles;
  profiles = profiles.filter((p) => p.id !== id);
  persistProfiles(profiles);
  if (getActiveProfileId() === id) {
    setActiveProfileId(profiles[0].id);
  }
  return profiles;
}

export function saveActiveVehicleForCurrentProfile(bp: VehicleBlueprint): void {
  const profile = getActiveProfile();
  profile.activeVehicle = bp;
  updateDriverProfile(profile);
}

export function saveVehicleSlotForCurrentProfile(bp: VehicleBlueprint): DriverProfile {
  const profile = getActiveProfile();
  const copy = cloneBlueprint(bp);
  copy.createdAt = Date.now();
  const idx = profile.savedVehicles.findIndex((item) => item.id === copy.id);
  if (idx >= 0) profile.savedVehicles[idx] = copy;
  else profile.savedVehicles.unshift(copy);
  profile.savedVehicles = profile.savedVehicles.slice(0, 12);
  updateDriverProfile(profile);
  return profile;
}

export function deleteVehicleSlotForCurrentProfile(vehicleId: string): DriverProfile {
  const profile = getActiveProfile();
  profile.savedVehicles = profile.savedVehicles.filter((item) => item.id !== vehicleId);
  updateDriverProfile(profile);
  return profile;
}

export function recordDriverStats(profileId: string, kosAdded: number, won: boolean): void {
  const profiles = loadProfiles();
  const p = profiles.find((item) => item.id === profileId);
  if (!p) return;
  p.totalKos += kosAdded;
  if (won) p.totalWins += 1;
  persistProfiles(profiles);
}
