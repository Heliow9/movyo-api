// src/api/api.js
import axios from "axios";
import { API_URL } from "./config";
import { getToken } from "./storage/session";
import { getAuthBlockMessageFromError } from "../utils/licenseGuard";

// mini event bus
export const authEvents = (() => {
  const subs = new Set();
  return {
    on(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    emit(ev) {
      subs.forEach((fn) => fn(ev));
    },
  };
})();

export const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
});

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    const bearer = String(token).startsWith("Bearer ") ? token : `Bearer ${token}`;
    config.headers = { ...(config.headers || {}), Authorization: bearer };
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    const data = err?.response?.data || {};
    const msg = data?.message || data?.mensagem || "";
    const lower = String(msg || "").toLowerCase();
    const url = String(err?.config?.url || "");

    // IMPORTANTE:
    // No app do garçom, algumas rotas protegidas podem retornar 401/403 por
    // diferença de payload/permissão/endpoint da API MySQL. Antes o interceptor
    // limpava a sessão em qualquer 401 e causava o loop: Login -> Home -> Login.
    // Agora a sessão só é derrubada quando a API informa claramente que o token
    // é inválido/expirado ou que o garçom foi desativado.
    const isGarcomDesativado =
      lower.includes("garçom desativado") || lower.includes("garcom desativado");

    const isTokenReallyInvalid =
      lower.includes("token inválido") ||
      lower.includes("token invalido") ||
      lower.includes("token expirado") ||
      lower.includes("jwt expired") ||
      lower.includes("jwt malformed") ||
      lower.includes("invalid token");

    const accessBlockMessage = getAuthBlockMessageFromError(err);
    const isLoginRequest = url.includes("/api/garcons/login") || url.includes("/api/restaurantes/login");

    if (!isLoginRequest && accessBlockMessage) {
      authEvents.emit({ type: "AUTH_LOGOUT_REQUIRED", status, message: accessBlockMessage });
      return Promise.reject(err);
    }

    if (!isLoginRequest && (isGarcomDesativado || isTokenReallyInvalid)) {
      authEvents.emit({ type: "AUTH_LOGOUT_REQUIRED", status, message: msg });
      return Promise.reject(err);
    }

    if (status === 403) {
      authEvents.emit({
        type: "PERMISSION_DENIED",
        status,
        message: msg || "Sem permissão.",
        permissaoNecessaria: data?.permissaoNecessaria || data?.permission || null,
      });
    }

    return Promise.reject(err);
  }
);
