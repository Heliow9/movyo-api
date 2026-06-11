function stripTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const rawApi = stripTrailingSlash(import.meta.env.VITE_API_URL || import.meta.env.VITE_API_ORIGIN || "https://api.movyo.delivery");

const API_ORIGIN = rawApi.endsWith("/api") ? rawApi.slice(0, -4) : rawApi;
const API_URL = rawApi.endsWith("/api") ? rawApi : `${rawApi}/api`;

// Compatibilidade com arquivos antigos da vitrine.
const API_BASE_URL = API_URL;
const MAPBOX_TOKEN = String(import.meta.env.VITE_MAPBOX_TOKEN || import.meta.env.REACT_APP_MAPBOX_TOKEN || "").trim();

export { API_ORIGIN, API_URL, API_BASE_URL, MAPBOX_TOKEN };
export default { API_ORIGIN, API_URL, API_BASE_URL, MAPBOX_TOKEN };
