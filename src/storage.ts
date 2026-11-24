import { STARTER_BLUEPRINTS, cloneBlueprint } from './blueprints';
import type { VehicleBlueprint } from './types';

const CUSTOM_SLOTS_KEY = 'brickforge_saved_vehicles_v1';
const ACTIVE_VEHICLE_KEY = 'brickforge_active_vehicle_v1';

export function loadActiveVehicle(): VehicleBlueprint {
  try {
    const raw = localStorage.getItem(ACTIVE_VEHICLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as VehicleBlueprint;
      if (parsed && Array.isArray(parsed.bricks) && parsed.bricks.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback to starter
  }
  return cloneBlueprint(STARTER_BLUEPRINTS[0]);
}

export function saveActiveVehicle(bp: VehicleBlueprint): void {
  try {
    localStorage.setItem(ACTIVE_VEHICLE_KEY, JSON.stringify(bp));
  } catch {
    // ignore quota issues
  }
}

export function loadSavedVehicles(): VehicleBlueprint[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SLOTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as VehicleBlueprint[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export function saveCustomVehicle(bp: VehicleBlueprint): VehicleBlueprint[] {
  const existing = loadSavedVehicles();
  const copy = cloneBlueprint(bp);
  copy.createdAt = Date.now();
  const idx = existing.findIndex((item) => item.id === copy.id);
  if (idx >= 0) {
    existing[idx] = copy;
  } else {
    existing.unshift(copy);
  }
  const trimmed = existing.slice(0, 12);
  try {
    localStorage.setItem(CUSTOM_SLOTS_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
  return trimmed;
}

export function deleteSavedVehicle(id: string): VehicleBlueprint[] {
  const remaining = loadSavedVehicles().filter((item) => item.id !== id);
  try {
    localStorage.setItem(CUSTOM_SLOTS_KEY, JSON.stringify(remaining));
  } catch {
    // ignore
  }
  return remaining;
}
