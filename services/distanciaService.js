const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
require("dotenv").config();

const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(/,(?=\d+$)/, ".");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const dentroDoRange = ({ latitude, longitude }) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

const normalizarCoordenadas = (coords = {}) => {
  if (typeof coords === "string") {
    try { return normalizarCoordenadas(JSON.parse(coords)); } catch (_) { return null; }
  }
  if (!coords || typeof coords !== "object") return null;

  const nested = coords.localizacao || coords.location || coords.geo || coords.coords || null;
  if (nested && nested !== coords) {
    const parsedNested = normalizarCoordenadas(nested);
    if (parsedNested) return parsedNested;
  }

  if (Array.isArray(coords.coordinates) && coords.coordinates.length >= 2) {
    // GeoJSON normalmente vem [longitude, latitude].
    const longitude = toNumber(coords.coordinates[0]);
    const latitude = toNumber(coords.coordinates[1]);
    const parsed = { latitude, longitude };
    return latitude !== null && longitude !== null && dentroDoRange(parsed) ? parsed : null;
  }

  const latitude = toNumber(coords.latitude ?? coords.lat ?? coords.latitud);
  const longitude = toNumber(coords.longitude ?? coords.lng ?? coords.lon ?? coords.long);

  if (latitude === null || longitude === null) return null;
  const parsed = { latitude, longitude };
  return dentroDoRange(parsed) ? parsed : null;
};

const calcularDistanciaLinear = (origem, destino) => {
  const earthRadiusMeters = 6371000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const lat1 = toRadians(origem.latitude);
  const lat2 = toRadians(destino.latitude);
  const deltaLat = toRadians(destino.latitude - origem.latitude);
  const deltaLng = toRadians(destino.longitude - origem.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getGoogleKey = () =>
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_DIRECTIONS_API_KEY ||
  process.env.GOOGLE_GEOCODING_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const calcularDistanciaGoogle = async (origem, destino) => {
  const googleKey = getGoogleKey();
  if (!googleKey) return null;

  const params = new URLSearchParams({
    origin: `${origem.latitude},${origem.longitude}`,
    destination: `${destino.latitude},${destino.longitude}`,
    mode: "driving",
    language: "pt-BR",
    key: googleKey,
  });

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.status !== "OK") {
    throw new Error(data.error_message || data.status || "Erro no Google Directions");
  }

  const distance = Number(data.routes?.[0]?.legs?.[0]?.distance?.value);
  return Number.isFinite(distance) ? distance : null;
};

const geocodificarEnderecoGoogle = async (endereco) => {
  const googleKey = getGoogleKey();
  if (!googleKey || !endereco) return null;

  const params = new URLSearchParams({ address: endereco, language: "pt-BR", key: googleKey });
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  const loc = data.results?.[0]?.geometry?.location;
  return normalizarCoordenadas({ latitude: loc?.lat, longitude: loc?.lng });
};

const geocodificarEndereco = async (endereco) => {
  const clean = String(endereco || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;

  try {
    const google = await geocodificarEnderecoGoogle(clean);
    if (google) return google;
  } catch (error) {
    console.warn("Erro ao geocodificar endereco pelo Google:", error.message);
  }

  return null;
};

const calcularDistanciaEntrega = async (latitude, longitude, origemLoja = {}) => {
  const destino = normalizarCoordenadas({ latitude, longitude });
  if (!destino) return null;

  const origem = normalizarCoordenadas(origemLoja);
  if (!origem) return null;

  try {
    const distanciaGoogle = await calcularDistanciaGoogle(origem, destino);
    if (Number.isFinite(distanciaGoogle)) return distanciaGoogle;
  } catch (error) {
    console.warn("Erro ao calcular distancia pelo Google Maps:", error.message);
  }

  return calcularDistanciaLinear(origem, destino);
};

const metrosParaKm = (metros) => {
  const n = Number(metros);
  return Number.isFinite(n) ? Number((n / 1000).toFixed(2)) : null;
};

module.exports = {
  calcularDistanciaEntrega,
  calcularDistanciaLinear,
  geocodificarEndereco,
  metrosParaKm,
  normalizarCoordenadas,
  calcularDistanciaGoogleMaps: (latitude, longitude, origemLoja) =>
    calcularDistanciaEntrega(latitude, longitude, origemLoja),
};
