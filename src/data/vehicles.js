import vehiclesData from './vehicles.json' with { type: 'json' };

export const VEHICLES = vehiclesData;

export function getVehicle(idx) {
  const i = Math.max(0, Math.min(VEHICLES.length - 1, idx | 0));
  return VEHICLES[i] || VEHICLES[0];
}

export function getVehicleById(id) {
  return VEHICLES.find(v => v.id === id) || VEHICLES[0];
}

export function getVehicleByName(name) {
  return VEHICLES.find(v => v.name.toLowerCase() === (name || '').toLowerCase()) || VEHICLES[0];
}

export default VEHICLES;
