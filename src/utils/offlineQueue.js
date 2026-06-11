// src/utils/offlineQueue.js
// ✅ Outbox offline simples (AsyncStorage) para POST de itens na comanda
// - enqueueAddItem({ mesaId, payload })
// - flushQueue({ api })
// - startQueueWatcher({ api, onFlush, onChange })
// - getQueueCount()

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const STORAGE_KEY = "@OFFLINE_OUTBOX_V1";

const safeParse = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

const readQueue = async () => {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const q = safeParse(raw, []);
  return Array.isArray(q) ? q : [];
};

const writeQueue = async (queue) => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
};

export const getQueueCount = async () => {
  const q = await readQueue();
  return q.length;
};

export const getQueueCountByMesa = async (mesaId) => {
  const q = await readQueue();
  const id = String(mesaId || "");
  return q.filter((job) => String(job?.mesaId || "") === id).length;
};

export const getQueueSnapshot = async () => {
  return await readQueue();
};

export const clearQueue = async () => {
  await writeQueue([]);
  return { ok: true };
};

export const enqueueAddItem = async ({ mesaId, payload }) => {
  const q = await readQueue();

  const item = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    type: "ADD_ITENS_MESA",
    mesaId: String(mesaId || ""),
    payload: payload || {},
    createdAt: new Date().toISOString(),
    tries: 0,
  };

  q.push(item);
  await writeQueue(q);

  return { ok: true, queued: 1, total: q.length };
};

export const flushQueue = async ({ api }) => {
  const net = await NetInfo.fetch();
  if (!net?.isConnected || net?.isInternetReachable === false) {
    const left = await getQueueCount();
    return { ok: true, sent: 0, left, reason: "offline" };
  }

  let q = await readQueue();
  if (!q.length) return { ok: true, sent: 0, left: 0 };

  let sent = 0;
  const nextQueue = [];

  for (const job of q) {
    try {
      if (job.type === "ADD_ITENS_MESA") {
        const mesaId = job.mesaId;
        const payload = job.payload || {};
        // ✅ mesma rota do app
        await api.post(`/api/garcons/app/mesa/${mesaId}/itens`, payload);
        sent += 1;
        continue; // remove da fila (não adiciona no nextQueue)
      }

      // se for tipo desconhecido, mantém
      nextQueue.push(job);
    } catch (err) {
      // Se deu erro de rede, para e mantém o job + restantes
      const isNetwork =
        !err?.response ||
        err?.message?.toLowerCase?.().includes("network") ||
        err?.code === "ECONNABORTED";

      const bumped = { ...job, tries: Number(job?.tries || 0) + 1, lastErrorAt: new Date().toISOString() };

      nextQueue.push(bumped);

      // mantém o resto da fila como está (não tenta mais agora)
      const idx = q.indexOf(job);
      const rest = idx >= 0 ? q.slice(idx + 1) : [];
      for (const r of rest) nextQueue.push(r);

      await writeQueue(nextQueue);
      return { ok: true, sent, left: nextQueue.length, reason: isNetwork ? "network" : "server" };
    }
  }

  // tudo enviado
  await writeQueue(nextQueue);
  return { ok: true, sent, left: nextQueue.length };
};

export const startQueueWatcher = ({ api, onFlush, onChange } = {}) => {
  let unsubNet = null;

  const fireChange = async () => {
    try {
      const left = await getQueueCount();
      onChange?.({ left });
    } catch {}
  };

  // listener de rede
  unsubNet = NetInfo.addEventListener(async (state) => {
    const isOnline = !!state?.isConnected && state?.isInternetReachable !== false;

    if (isOnline) {
      const res = await flushQueue({ api });
      onFlush?.(res);
      await fireChange();
    } else {
      await fireChange();
    }
  });

  // chama uma vez no start
  fireChange();

  return () => {
    try {
      unsubNet?.();
    } catch {}
  };
};
