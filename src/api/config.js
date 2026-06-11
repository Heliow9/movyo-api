// src/api/config.js
// Centraliza a URL da API para manter o app do garçom padronizado com o desktop.
// No Expo use EXPO_PUBLIC_API_URL; em builds antigos também aceitamos API_URL.
const env = typeof process !== "undefined" && process?.env ? process.env : {};

const rawUrl = env.EXPO_PUBLIC_API_URL || env.API_URL || "https://api.movyo.delivery";

export const API_URL = String(rawUrl || "https://api.movyo.delivery").replace(/\/+$/, "");
