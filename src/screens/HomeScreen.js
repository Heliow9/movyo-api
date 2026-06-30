// src/screens/HomeScreen.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Animated,
  LayoutAnimation,
  UIManager,
  Platform,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import AppVersionInfo from "../components/AppVersionInfo";

import { api } from "../api/api";
import { clearSession, getSession } from "../api/storage/session";
import { connectSocket, getSocket } from "../socket/socket";
import { useAppTheme } from "../theme/ThemeProvider";
import { cachedApiGet, cacheGetData, cacheSet } from "../utils/smartCache";
import { flushQueue, getQueueCount, startQueueWatcher } from "../utils/offlineQueue";

const RESUMO_CACHE_KEY = "garcom:dashboard:resumo:v4-dia-garcom";

const moneyBRL = (n) => {
  const v = Number(n || 0);
  try { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  catch { return `R$ ${v.toFixed(2)}`; }
};

const fmtTime = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return "";
  return dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

const normalizeResumo = (data = {}, session = null) => {
  const garcomNome = session?.garcom?.apelido || session?.garcom?.nome || "Garçom";

  // Vendas do turno no app = vendas de HOJE do garçom logado.
  // Não usa totalTurno/vendasTurno como fallback porque em algumas APIs esse campo vinha acumulativo.
  const vendasHojeGarcomRaw =
    data?.vendasHojeGarcom ??
    data?.totalVendasHojeGarcom ??
    data?.totalHojeGarcom ??
    data?.garcom?.vendasHoje ??
    data?.resumoGarcom?.vendasHoje;
  const vendas = Number(vendasHojeGarcomRaw ?? 0) || 0;

  const pedidosPendentes = Number(data?.pedidosPendentes ?? data?.pedidosFila ?? data?.pedidosAtivos ?? 0) || 0;
  const mesasAbertas = Number(data?.mesasAbertas ?? data?.mesasOcupadas ?? data?.mesasAtivas ?? 0) || 0;
  const tempoMedio = data?.tempoMedio ?? data?.tempoMedioAtendimento ?? data?.tempoMedioPedido ?? "—";
  const ranking = Array.isArray(data?.rankingGarconsHoje) && data.rankingGarconsHoje.length
    ? data.rankingGarconsHoje
    : Array.isArray(data?.rankingGarcons) && data.rankingGarcons.length
      ? data.rankingGarcons
      : [{ nome: garcomNome, total: vendas, pedidos: Number(data?.pedidosHojeGarcom || 0) }];

  return {
    mesasAbertas,
    pedidosPendentes,
    vendasTurno: vendas,
    tempoMedio,
    ranking: ranking.slice(0, 5),
  };
};


const pickRestauranteId = (session) =>
  session?.restaurante?._id || session?.restaurante?.id || session?.restaurante?.restauranteId || null;

const countMesasAbertas = (mesas = []) => {
  const statusAbertos = new Set(["ocupada", "ocupado", "aberta", "em_aberto", "aberto", "em_uso", "uso"]);
  return (Array.isArray(mesas) ? mesas : []).filter((m) => statusAbertos.has(String(m?.status || "").trim().toLowerCase())).length;
};

export default function HomeScreen({ navigation, onLogout }) {
  const { headerGradient } = useAppTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);

  const [session, setSession] = useState(null);
  const [dashboard, setDashboard] = useState(normalizeResumo());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 850, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const runPulse = useCallback(() => {
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 460, useNativeDriver: true }),
    ]).start();
  }, [pulse]);

  const loadQueueCount = useCallback(async () => {
    try { setQueueCount(await getQueueCount()); } catch { setQueueCount(0); }
  }, []);

  const fetchDashboard = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const s = await getSession();
      setSession(s || null);

      const cached = await cacheGetData(RESUMO_CACHE_KEY, null);
      if (cached && !dashboard?.mesasAbertas && !dashboard?.pedidosPendentes) {
        setDashboard(normalizeResumo(cached, s));
        setFromCache(true);
      }

      const result = await cachedApiGet({
        key: RESUMO_CACHE_KEY,
        request: () => api.get("/api/garcons/app/resumo"),
        fallback: cached || {},
      });

      const resumoNormalizado = normalizeResumo(result.data, s);

      // Fonte de verdade para o card/badge de mesas: lista real de mesas.
      // Algumas versões da API retornavam mesasAbertas = 0 no resumo mesmo com comanda aberta.
      try {
        const mesasRes = await api.get("/api/garcons/app/mesas");
        const mesas = Array.isArray(mesasRes?.data) ? mesasRes.data : [];
        resumoNormalizado.mesasAbertas = countMesasAbertas(mesas);
      } catch (_) {
        const rid = pickRestauranteId(s);
        if (rid) {
          try {
            const mesasRes = await api.get(`/api/mesas/restaurante/${rid}`);
            const mesas = Array.isArray(mesasRes?.data) ? mesasRes.data : mesasRes?.data?.mesas || mesasRes?.data?.items || [];
            resumoNormalizado.mesasAbertas = countMesasAbertas(mesas);
          } catch (_) {}
        }
      }

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setDashboard(resumoNormalizado);
      setFromCache(!!result.fromCache);
      setLastUpdatedAt(result.savedAt || new Date().toISOString());
      runPulse();
    } catch (e) {
      if (!silent) Alert.alert("Ops", "Não foi possível atualizar o dashboard agora.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      await loadQueueCount();
    }
  }, [dashboard?.mesasAbertas, dashboard?.pedidosPendentes, loadQueueCount, runPulse]);

  const syncNow = useCallback(async () => {
    try {
      setSyncing(true);
      const res = await flushQueue({ api });
      await loadQueueCount();
      await fetchDashboard({ silent: true });
      if (res?.sent > 0) Alert.alert("Sincronizado", `${res.sent} ação(ões) enviadas ao servidor.`);
    } finally {
      setSyncing(false);
    }
  }, [fetchDashboard, loadQueueCount]);

  useEffect(() => {
    fetchDashboard();
    const unsubNet = NetInfo.addEventListener(async (state) => {
      const online = !!state?.isConnected && state?.isInternetReachable !== false;
      setIsOnline(online);
      if (online) syncNow();
      else loadQueueCount();
    });
    const unsubQueue = startQueueWatcher({ api, onFlush: () => fetchDashboard({ silent: true }), onChange: loadQueueCount });
    return () => { unsubNet?.(); unsubQueue?.(); };
  }, []);

  useEffect(() => {
    let socket;
    (async () => {
      const s = await getSession();
      const restauranteId = s?.restaurante?._id;
      if (!restauranteId) return;
      socket = connectSocket(restauranteId);
      const schedule = () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => fetchDashboard({ silent: true }), 600);
      };
      ["mesaAtualizada", "pedidoAtualizado", "novoPedido", "mesaCriada", "mesaExcluida"].forEach((ev) => socket.on(ev, schedule));
    })();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const s = getSocket();
      ["mesaAtualizada", "pedidoAtualizado", "novoPedido", "mesaCriada", "mesaExcluida"].forEach((ev) => s?.off(ev));
    };
  }, [fetchDashboard]);

  const restauranteNome = session?.restaurante?.nome || "Movyo Garçom";
  const garcomNome = session?.garcom?.apelido || session?.garcom?.nome || "Pronto pra atender";

  const onRefresh = () => { setRefreshing(true); fetchDashboard({ silent: true }); };
  const logout = () => Alert.alert("Sair", "Deseja encerrar sua sessão?", [
    { text: "Cancelar", style: "cancel" },
    { text: "Sair", style: "destructive", onPress: async () => { setLoggingOut(true); await clearSession(); setLoggingOut(false); onLogout?.(); } },
  ]);

  const Skeleton = ({ height = 22, width = "70%" }) => (
    <Animated.View style={[styles.skeleton, { height, width, opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] }) }]} />
  );

  const Kpi = ({ icon, label, value, sub }) => (
    <Animated.View style={[styles.kpiCard, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }] }]}>
      <View style={styles.kpiIcon}><Ionicons name={icon} size={18} color="#fff" /></View>
      {loading ? <Skeleton height={24} width="58%" /> : <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>}
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiSub} numberOfLines={1}>{sub}</Text>
    </Animated.View>
  );

  const Action = ({ icon, title, sub, onPress, badge }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}>
      <View style={styles.actionTop}>
        <View style={styles.actionIcon}><Ionicons name={icon} size={20} color="#083358" /></View>
        {badge != null && <View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View>}
      </View>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSub}>{sub}</Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={headerGradient} style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}><Ionicons name="restaurant" size={18} color="#fff" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.hTitle} numberOfLines={1}>{restauranteNome}</Text>
            <Text style={styles.hSub} numberOfLines={1}>{garcomNome}</Text>
          </View>
          <Pressable onPress={logout} disabled={loggingOut} style={styles.logoutBtn}>
            {loggingOut ? <ActivityIndicator color="#fff" /> : <Ionicons name="log-out-outline" size={18} color="#fff" />}
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={[styles.statusPill, !isOnline && styles.statusOffline]}>
            <Ionicons name={isOnline ? "cloud-done-outline" : "cloud-offline-outline"} size={14} color="#fff" />
            <Text style={styles.statusText}>{isOnline ? "Online e sincronizado" : "Modo offline ativo"}</Text>
          </View>
          {(queueCount > 0 || fromCache) && (
            <Pressable onPress={syncNow} disabled={!isOnline || syncing} style={styles.syncPill}>
              {syncing ? <ActivityIndicator size="small" color="#083358" /> : <Ionicons name="sync" size={14} color="#083358" />}
              <Text style={styles.syncText}>{queueCount} pendente(s)</Text>
            </Pressable>
          )}
        </View>
      </LinearGradient>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="wifi-outline" size={18} color="#92400e" />
            <Text style={styles.offlineText}>Sem internet: pedidos e catálogo usam cache. Ao voltar, o app envia tudo para o servidor MySQL automaticamente.</Text>
          </View>
        )}

        <View style={styles.kpiGrid}>
          <Kpi icon="grid-outline" label="Mesas abertas" value={String(dashboard.mesasAbertas)} sub="Ocupadas agora" />
          <Kpi icon="receipt-outline" label="Pedidos pendentes" value={String(dashboard.pedidosPendentes)} sub="Fila do atendimento" />
          <Kpi icon="cash-outline" label="Vendas do turno" value={moneyBRL(dashboard.vendasTurno)} sub="Hoje do garçom" />
          <Kpi icon="timer-outline" label="Tempo médio" value={String(dashboard.tempoMedio || "—")} sub="Atendimento" />
        </View>

        <Text style={styles.sectionTitle}>Ações rápidas</Text>
        <View style={styles.actionsGrid}>
          <Action icon="grid-outline" title="Mesas" sub="Abrir e ver consumo" badge={dashboard.mesasAbertas} onPress={() => navigation.navigate("Mesas")} />
          <Action icon="receipt-outline" title="Pedidos" sub="Fila e status" badge={dashboard.pedidosPendentes} onPress={() => navigation.navigate("Pedidos")} />
          <Action icon="storefront-outline" title="Balcão" sub="Pedido rápido + PIX" onPress={() => navigation.navigate("Balcao")} />
          <Action icon="person-outline" title="Meu perfil" sub="Permissões e dados" onPress={() => navigation.navigate("MeuPerfil")} />
          <Action icon="sync-outline" title="Sincronizar" sub="Enviar offline" badge={queueCount} onPress={syncNow} />
        </View>

        <Text style={styles.sectionTitle}>Ranking dos garçons</Text>
        <View style={styles.rankingCard}>
          {dashboard.ranking.map((g, idx) => (
            <View key={`${g?.nome || idx}_${idx}`} style={styles.rankRow}>
              <View style={styles.rankPos}><Text style={styles.rankPosText}>{idx + 1}</Text></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rankName} numberOfLines={1}>{g?.nome || g?.apelido || "Garçom"}</Text>
                <Text style={styles.rankSub}>{Number(g?.pedidos || 0)} pedido(s)</Text>
              </View>
              <Text style={styles.rankValue}>{moneyBRL(g?.total ?? g?.vendas ?? 0)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.updated}>{lastUpdatedAt ? `Atualizado às ${fmtTime(lastUpdatedAt)}${fromCache ? " • cache" : ""}` : "Toque e puxe para atualizar"}</Text>
        <AppVersionInfo variant="dark" style={styles.versionInfo} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1220" },
  header: { paddingTop: 54, paddingHorizontal: 18, paddingBottom: 24, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  hTitle: { color: "#fff", fontSize: 21, fontWeight: "900", letterSpacing: -0.5 },
  hSub: { color: "rgba(255,255,255,0.82)", fontWeight: "700", marginTop: 2 },
  logoutBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  statusRow: { marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statusPill: { flex: 1, minHeight: 38, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "rgba(34,197,94,0.24)", flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.20)" },
  statusOffline: { backgroundColor: "rgba(245,158,11,0.28)" },
  statusText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  syncPill: { minHeight: 38, paddingHorizontal: 12, borderRadius: 999, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", gap: 7 },
  syncText: { color: "#083358", fontWeight: "900", fontSize: 12 },
  content: { flex: 1, backgroundColor: "#f4f7fb" },
  contentInner: { padding: 16, paddingBottom: 34 },
  offlineBanner: { marginBottom: 14, padding: 12, borderRadius: 20, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", flexDirection: "row", gap: 9, alignItems: "flex-start" },
  offlineText: { flex: 1, color: "#92400e", fontWeight: "800", lineHeight: 18, fontSize: 12 },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  kpiCard: { width: "48.5%", minHeight: 132, padding: 14, borderRadius: 26, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(15,23,42,0.07)", shadowColor: "#0f172a", shadowOpacity: 0.09, shadowRadius: 18, elevation: 3 },
  kpiIcon: { width: 34, height: 34, borderRadius: 13, backgroundColor: "#083358", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  kpiValue: { color: "#0f172a", fontSize: 23, fontWeight: "900", letterSpacing: -0.6 },
  kpiLabel: { color: "#334155", fontWeight: "900", marginTop: 4 },
  kpiSub: { color: "#64748b", fontWeight: "700", marginTop: 4, fontSize: 12 },
  skeleton: { backgroundColor: "#e2e8f0", borderRadius: 999, marginTop: 4, marginBottom: 6 },
  sectionTitle: { marginTop: 20, marginBottom: 10, color: "#0f172a", fontWeight: "900", fontSize: 17, letterSpacing: -0.3 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCard: { width: "48.5%", minHeight: 126, borderRadius: 24, backgroundColor: "#fff", padding: 14, borderWidth: 1, borderColor: "rgba(15,23,42,0.07)", shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  actionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actionIcon: { width: 38, height: 38, borderRadius: 15, backgroundColor: "#eef6ff", alignItems: "center", justifyContent: "center" },
  badge: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 999, backgroundColor: "#ff3b8a", alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  actionTitle: { color: "#0f172a", fontWeight: "900", fontSize: 16, marginTop: 14 },
  actionSub: { color: "#64748b", fontWeight: "700", marginTop: 4, fontSize: 12 },
  rankingCard: { borderRadius: 26, padding: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(15,23,42,0.07)", shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 },
  rankRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: "rgba(15,23,42,0.06)" },
  rankPos: { width: 32, height: 32, borderRadius: 12, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  rankPosText: { color: "#fff", fontWeight: "900" },
  rankName: { color: "#0f172a", fontWeight: "900" },
  rankSub: { color: "#64748b", fontWeight: "700", marginTop: 2, fontSize: 12 },
  rankValue: { color: "#083358", fontWeight: "900" },
  updated: { textAlign: "center", color: "#64748b", fontWeight: "700", marginTop: 18, fontSize: 12 },
  versionInfo: { marginTop: 8 },
});
