// src/theme/themeStorage.js
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@movyo_theme_preset_id";

export async function getThemePresetId() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v || null;
  } catch {
    return null;
  }
}

export async function setThemePresetId(id) {
  try {
    await AsyncStorage.setItem(KEY, String(id));
    return true;
  } catch {
    return false;
  }
}
