function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const rawApi = stripTrailingSlash(import.meta.env.VITE_API_URL || import.meta.env.VITE_API_ORIGIN || "https://api.movyo.delivery");

const API_ORIGIN = rawApi.endsWith("/api") ? rawApi.slice(0, -4) : rawApi;
const API_URL = rawApi.endsWith("/api") ? rawApi : `${rawApi}/api`;
const API_BASE_URL = API_URL;
const GOOGLE_MAPS_API_KEY = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_KEY || "").trim();

export { API_ORIGIN, API_URL, API_BASE_URL, GOOGLE_MAPS_API_KEY };
export default { API_ORIGIN, API_URL, API_BASE_URL, GOOGLE_MAPS_API_KEY };
