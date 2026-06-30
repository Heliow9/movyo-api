const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
require("dotenv").config();

const DEFAULT_STORE_COORDS = {
  latitude: -8.01548359750091,
  longitude: -34.85672369599343,
};

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizarCoordenadas = (coords = {}) => {
  const latitude = toNumber(coords.latitude ?? coords.lat);
  const longitude = toNumber(coords.longitude ?? coords.lng ?? coords.lon);

  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
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

const calcularDistanciaGoogle = async (origem, destino) => {
  const googleKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_DIRECTIONS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

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

const calcularDistanciaEntrega = async (latitude, longitude, origemLoja = {}) => {
  const destino = normalizarCoordenadas({ latitude, longitude });
  if (!destino) return null;

  const origem = normalizarCoordenadas(origemLoja) || DEFAULT_STORE_COORDS;

  try {
    const distanciaGoogle = await calcularDistanciaGoogle(origem, destino);
    if (Number.isFinite(distanciaGoogle)) return distanciaGoogle;
  } catch (error) {
    console.warn("Erro ao calcular distancia pelo Google Maps:", error.message);
  }

  return calcularDistanciaLinear(origem, destino);
};

module.exports = {
  calcularDistanciaEntrega,
  calcularDistanciaMapbox: (latitude, longitude, origemLoja) =>
    calcularDistanciaEntrega(latitude, longitude, origemLoja),
};
