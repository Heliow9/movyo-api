import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@movyo_garcom_session_v1";

/* =========================
   Helpers
========================= */

function safeObj(v) {
  return v && typeof v === "object" ? v : null;
}

function safeBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

/* =========================
   Save / Get sessão
========================= */

export async function saveSession({ token, restaurante, garcom, tipo = "garcom" }) {
  const r = safeObj(restaurante);
  const g = safeObj(garcom);

  const payload = {
    token: token ? String(token) : null,
    tipo: tipo === "restaurante" ? "restaurante" : "garcom",

    restaurante: r
      ? {
          _id: r._id || r.id || r.restauranteId || r.codigo || null,
          id: r.id || r._id || r.restauranteId || r.codigo || null,
          nome: r.nome || r.name || null,
          slugIdentificador: r.slugIdentificador || r.slug || r.identificador || null,
          plano: r.plano || r.plan || null,
          ativo: r.ativo !== false,
          bloqueado: r.bloqueado === true || r.suspenso === true,
          status: r.status || null,
          statusAssinatura: r.statusAssinatura || r.statusPlano || r.statusLicenca || null,
          dataFimPlano: r.dataFimPlano || r.dataVencimentoPlano || r.vencimentoPlano || r.vencimento || null,

          // ✅ manter status MercadoPago no app
          mercadoPago: {
            conectado: safeBool(r?.mercadoPago?.conectado),
          },
        }
      : null,

    garcom: g
      ? {
          _id: g._id || g.id || g.garcomId || null,
          id: g.id || g._id || g.garcomId || null,
          nome: g.nome || g.name || null,
          apelido: g.apelido || null,
          telefone: g.telefone || null,
          ativo: g.ativo !== false,
          permissoes:
            g.permissoes && typeof g.permissoes === "object"
              ? g.permissoes
              : {},
        }
      : null,
  };

  await AsyncStorage.setItem(KEY, JSON.stringify(payload));
}

export async function getSession() {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const restaurante =
      parsed.restaurante && typeof parsed.restaurante === "object"
        ? parsed.restaurante
        : null;

    // ✅ normaliza mercadoPago
    const mp =
      restaurante?.mercadoPago && typeof restaurante.mercadoPago === "object"
        ? restaurante.mercadoPago
        : null;

    return {
      token: parsed.token || null,

      restaurante: restaurante
        ? {
            ...restaurante,
            mercadoPago: {
              conectado: safeBool(mp?.conectado),
            },
          }
        : null,

      garcom: parsed.garcom || null,
      tipo: parsed.tipo === "restaurante" ? "restaurante" : "garcom",
    };
  } catch {
    return null;
  }
}

export async function getToken() {
  const s = await getSession();
  const t = s?.token ? String(s.token).trim() : "";
  return t || null;
}

export async function isLogged() {
  const t = await getToken();
  return !!t;
}

export async function clearSession() {
  await AsyncStorage.removeItem(KEY);
}

/* =========================
   PATCHES (parciais)
========================= */

/**
 * ✅ Atualiza parcialmente o restaurante salvo na sessão
 * (uso no ComandaScreen pra mercadoPago.conectado)
 */
export async function updateSessionRestaurantePatch(patch = {}) {
  const s = await getSession();
  if (!s?.restaurante) return null;

  const next = {
    ...s,
    restaurante: {
      ...s.restaurante,
      ...patch,
      mercadoPago: {
        ...(s.restaurante.mercadoPago || {}),
        ...(patch.mercadoPago || {}),
        conectado: safeBool(
          patch?.mercadoPago?.conectado ??
            s.restaurante?.mercadoPago?.conectado
        ),
      },
    },
  };

  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/**
 * ✅ Atualiza parcialmente o garçom salvo na sessão
 * (uso no MeuPerfilScreen para sincronizar permissões reais do backend)
 */
export async function updateSessionGarcomPatch(patch = {}) {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;

  let current;
  try {
    current = JSON.parse(raw);
  } catch {
    return null;
  }

  const currGarcom =
    current?.garcom && typeof current.garcom === "object"
      ? current.garcom
      : {};

  const patchObj = safeObj(patch) || {};

  const next = {
    ...current,
    garcom: {
      ...currGarcom,
      ...patchObj,
      ativo:
        patchObj?.ativo !== undefined
          ? patchObj.ativo !== false
          : currGarcom.ativo !== false,
      permissoes: {
        ...(safeObj(currGarcom.permissoes) || {}),
        ...(safeObj(patchObj.permissoes) || {}),
      },
    },
  };

  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
