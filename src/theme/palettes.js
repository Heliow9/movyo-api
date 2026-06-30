// src/theme/palettes.js
export const THEME_PRESETS = [
  { id: "movyo", name: "Movyo Premium", colors: ["#ff3b8a", "#ff9b2d"] },
  { id: "sunset", name: "Sunset", colors: ["#ff3b8a", "#ff9b2d"] },
  { id: "ocean", name: "Ocean", colors: ["#06b6d4", "#2563eb"] },
  { id: "grape", name: "Grape", colors: ["#a855f7", "#ec4899"] },
  { id: "mint", name: "Mint", colors: ["#22c55e", "#14b8a6"] },
  { id: "fire", name: "Fire", colors: ["#fb7185", "#f97316"] },
  { id: "night", name: "Night", colors: ["#0f172a", "#334155"] },
];

export const DEFAULT_THEME_ID = "movyo";

export function getPresetById(id) {
  return THEME_PRESETS.find((p) => p.id === id) || THEME_PRESETS[0];
}
