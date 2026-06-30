import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@movyo_garcom_remember_login_v1";

export async function setRememberedLogin(value) {
  const v = String(value || "").trim();
  if (!v) return AsyncStorage.removeItem(KEY);
  return AsyncStorage.setItem(KEY, v);
}

export async function getRememberedLogin() {
  const v = await AsyncStorage.getItem(KEY);
  return v ? String(v) : "";
}

export async function clearRememberedLogin() {
  return AsyncStorage.removeItem(KEY);
}
