import AsyncStorage from "@react-native-async-storage/async-storage";

const prefix = "@MOVYO_SMART_CACHE_V1:";

const parse = (raw, fallback = null) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

export const cacheSet = async (key, data) => {
  const payload = { data, savedAt: new Date().toISOString() };
  await AsyncStorage.setItem(`${prefix}${key}`, JSON.stringify(payload));
  return payload;
};

export const cacheGet = async (key, fallback = null) => {
  const payload = parse(await AsyncStorage.getItem(`${prefix}${key}`), null);
  return payload || fallback;
};

export const cacheGetData = async (key, fallback = null) => {
  const payload = await cacheGet(key, null);
  return payload?.data ?? fallback;
};

export const cacheRemove = async (key) => AsyncStorage.removeItem(`${prefix}${key}`);

export const cachedApiGet = async ({ key, request, fallback = null, onCache }) => {
  const cached = await cacheGet(key, null);
  if (cached?.data != null) onCache?.(cached);
  try {
    const res = await request();
    await cacheSet(key, res?.data ?? res);
    return { data: res?.data ?? res, fromCache: false, savedAt: new Date().toISOString() };
  } catch (err) {
    if (cached?.data != null) return { data: cached.data, fromCache: true, savedAt: cached.savedAt, error: err };
    if (fallback != null) return { data: fallback, fromCache: true, savedAt: null, error: err };
    throw err;
  }
};
