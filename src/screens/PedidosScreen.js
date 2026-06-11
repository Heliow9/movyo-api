// src/screens/PedidosScreen.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import { api } from "../api/api";
import { getSession } from "../api/storage/session";
import { connectSocket, getSocket } from "../socket/socket";
import { useAppTheme } from "../theme/ThemeProvider";
import { cachedApiGet } from "../utils/smartCache";

const PEDIDOS_CACHE_KEY = "garcom:pedidos:list:v3:hoje";

const STATUS_LABELS = {
  pendente: "Pendente",
  aguardando_resposta: "Aguardando",
  em_producao: "Produção",
  producao: "Produção",
  preparando: "Produção",
  em_preparo: "Produção",
  pronto: "Pronto",
  em_entrega: "Entrega",
  em_rota: "Rota",
  entregue: "Entregue",
  finalizado: "Finalizado",
  cancelado: "Cancelado",
};

const STATUS_ORDER = [
  "todos",
  "pendente",
  "aguardando_resposta",
  "em_producao",
  "producao",
  "preparando",
  "em_preparo",
  "pronto",
  "em_entrega",
  "em_rota",
  "entregue",
  "finalizado",
  "cancelado",
];

const money = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const safeText = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return String(v.nome || v.name || v.titulo || v.title || v.label || "");
  return "";
};

const normalizeStatus = (status) => String(status || "pendente").trim().toLowerCase();
const HIDDEN_FROM_PEDIDOS = new Set(["aguardando_pagamento", "pagamento_pendente"]);
const isTodayLocal = (value) => {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};
const pad2 = (n) => String(n).padStart(2, "0");
const todayIsoLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const brToIsoDate = (value) => {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
};
const isoToBrDate = (value) => {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const isSameLocalDate = (value, iso) => {
  const d = value ? new Date(value) : null;
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d || Number.isNaN(d.getTime()) || !m) return false;
  return d.getFullYear() === Number(m[1]) && d.getMonth() + 1 === Number(m[2]) && d.getDate() === Number(m[3]);
};
const isPedidoVisivel = (p) => !HIDDEN_FROM_PEDIDOS.has(normalizeStatus(p?.status)) && !HIDDEN_FROM_PEDIDOS.has(normalizeStatus(p?.statusPagamento));
const statusLabel = (status) => STATUS_LABELS[normalizeStatus(status)] || safeText(status) || "Pendente";

const pickPedidoId = (p) => p?._id || p?.id || p?.pedidoId;
const pickCriadoEm = (p) => p?.criadoEm || p?.createdAt || p?.data || p?.updatedAt;
const pickCliente = (p) =>
  safeText(p?.nomeCliente || p?.cliente?.nome || p?.clienteNome || p?.mesaCliente || p?.cliente) ||
  (p?.mesaNumero ? `Mesa ${p.mesaNumero}` : "Cliente");
const pickNumero = (p) => p?.numeroPedido || p?.numero_pedido || p?.pedidoNumero || p?.codigoPedido || p?.numero || p?.codigo || p?._id?.slice?.(-6) || "—";
const pickTotal = (p) => p?.total ?? p?.valorTotal ?? p?.valor ?? p?.subtotal ?? 0;
const pickPagamento = (p) => safeText(p?.formaPagamento || p?.formadePagamento || p?.metodoPagamento || p?.pagamento?.metodo || p?.pagamento || p?.pagamentos?.[0]?.metodo || "Não informado");
const pickItens = (p) => (Array.isArray(p?.itens) ? p.itens : Array.isArray(p?.items) ? p.items : []);

function fmtDate(v) {
  if (!v) return "Agora";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "Agora";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function itemName(it) {
  return safeText(it?.nome || it?.produto?.nome || it?.produtoNome || it?.descricao || it?.name) || "Item";
}

function itemQty(it) {
  const q = Number(it?.quantidade ?? it?.qtd ?? it?.quantity ?? 1);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

export default function PedidosScreen({ navigation }) {
  const { headerGradient } = useAppTheme();
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [dataFiltro, setDataFiltro] = useState(isoToBrDate(todayIsoLocal()));
  const [dataAplicada, setDataAplicada] = useState(todayIsoLocal());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const animateUpdate = useCallback(() => {
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [pulse]);

  const normalizeResponse = useCallback((data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.pedidos)) return data.pedidos;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  }, []);

  const fetchPedidos = useCallback(async () => {
    try {
      const result = await cachedApiGet({
        key: `${PEDIDOS_CACHE_KEY}:${dataAplicada}`,
        request: () => api.get("/api/garcons/app/pedidos", { params: { limit: 300, dataInicio: dataAplicada, dataFim: dataAplicada } }),
        fallback: [],
      });
      const list = normalizeResponse(result?.data)
        .filter(isPedidoVisivel)
        .filter((p) => isSameLocalDate(pickCriadoEm(p) || p?.pagoEm, dataAplicada));
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPedidos(list);
      setFromCache(!!result?.fromCache);
      setLastUpdatedAt(new Date(result?.savedAt || Date.now()));
      animateUpdate();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.mensagem || "Erro ao carregar pedidos.";
      Alert.alert("Ops", msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [animateUpdate, dataAplicada, normalizeResponse]);

  useEffect(() => {
    fetchPedidos();
    const unsub = NetInfo.addEventListener((state) => {
      const online = !!state?.isConnected && state?.isInternetReachable !== false;
      setIsOnline(online);
      if (online) fetchPedidos();
    });
    return () => unsub?.();
  }, [fetchPedidos]);

  useEffect(() => {
    let socket;
    (async () => {
      const session = await getSession();
      const restauranteId = session?.restaurante?._id;
      if (!restauranteId) return;

      socket = connectSocket(restauranteId);
      const reload = () => fetchPedidos();
      socket.on("novoPedido", reload);
      socket.on("pedidoAtualizado", reload);
      socket.on("pedidoCancelado", reload);
      socket.on("mesaAtualizada", reload);
    })();

    return () => {
      const s = getSocket();
      s?.off("novoPedido");
      s?.off("pedidoAtualizado");
      s?.off("pedidoCancelado");
      s?.off("mesaAtualizada");
    };
  }, [fetchPedidos]);

  const stats = useMemo(() => {
    const ativos = pedidos.filter((p) => !["cancelado", "entregue", "finalizado"].includes(normalizeStatus(p?.status))).length;
    const producao = pedidos.filter((p) => ["em_producao", "producao", "preparando", "em_preparo"].includes(normalizeStatus(p?.status))).length;
    const totalListado = pedidos.reduce((acc, p) => acc + Number(pickTotal(p) || 0), 0);
    return { ativos, producao, totalListado };
  }, [pedidos]);

  const counts = useMemo(() => {
    const out = { todos: pedidos.length };
    pedidos.forEach((p) => {
      const st = normalizeStatus(p?.status);
      out[st] = (out[st] || 0) + 1;
    });
    return out;
  }, [pedidos]);

  const pedidosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pedidos
      .filter((p) => filtro === "todos" || normalizeStatus(p?.status) === filtro)
      .filter((p) => {
        if (!q) return true;
        const hay = [pickNumero(p), pickCliente(p), p?.telefoneCliente, p?.mesaNumero, p?.origem, pickPagamento(p)]
          .map(safeText)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(pickCriadoEm(b)).getTime() - new Date(pickCriadoEm(a)).getTime());
  }, [busca, filtro, pedidos]);

  const aplicarData = () => {
    const iso = brToIsoDate(dataFiltro);
    if (!iso) return Alert.alert("Data inválida", "Informe a data no formato DD/MM/AAAA.");
    setDataAplicada(iso);
  };

  const voltarParaHoje = () => {
    const hoje = todayIsoLocal();
    setDataFiltro(isoToBrDate(hoje));
    setDataAplicada(hoje);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchPedidos();
  };

  const cancelarPedido = (pedido) => {
    const id = pickPedidoId(pedido);
    if (!id) return;

    Alert.alert("Cancelar pedido", `Deseja cancelar o pedido #${pickNumero(pedido)}?`, [
      { text: "Voltar", style: "cancel" },
      {
        text: "Cancelar pedido",
        style: "destructive",
        onPress: async () => {
          try {
            setBusyId(id);
            await api.post(`/api/garcons/app/pedido/${id}/cancelar`, {});
            await fetchPedidos();
          } catch (err) {
            const msg = err?.response?.data?.message || err?.response?.data?.mensagem || "Não foi possível cancelar.";
            Alert.alert("Ops", msg);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const cancelarItem = (pedido, index, it) => {
    const id = pickPedidoId(pedido);
    if (!id) return;

    Alert.alert("Cancelar item", `Cancelar ${itemQty(it)}x ${itemName(it)}?`, [
      { text: "Voltar", style: "cancel" },
      {
        text: "Cancelar item",
        style: "destructive",
        onPress: async () => {
          try {
            setBusyId(`${id}_${index}`);
            await api.post(`/api/garcons/app/pedido/${id}/item/${index}/cancelar`, {});
            await fetchPedidos();
          } catch (err) {
            const msg = err?.response?.data?.message || err?.response?.data?.mensagem || "Não foi possível cancelar o item.";
            Alert.alert("Ops", msg);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  const renderPedido = (pedido) => {
    const id = pickPedidoId(pedido);
    const itens = pickItens(pedido);
    const st = normalizeStatus(pedido?.status);
    const canCancel = !["cancelado", "entregue", "finalizado"].includes(st);

    return (
      <View key={id || `${pickNumero(pedido)}_${pickCriadoEm(pedido)}`} style={styles.card}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.orderTitle} numberOfLines={1}>Pedido #{pickNumero(pedido)}</Text>
            <Text style={styles.orderSub} numberOfLines={1}>{pickCliente(pedido)} • {fmtDate(pickCriadoEm(pedido))}</Text>
          </View>
          <View style={[styles.statusPill, st === "cancelado" && styles.statusCancelado]}>
            <Text style={[styles.statusText, st === "cancelado" && styles.statusCanceladoText]}>{statusLabel(st)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoBadge}><Ionicons name="cash-outline" size={14} color="#083358" /><Text style={styles.infoText}>{money(pickTotal(pedido))}</Text></View>
          <View style={styles.infoBadge}><Ionicons name="card-outline" size={14} color="#083358" /><Text style={styles.infoText}>{pickPagamento(pedido)}</Text></View>
          <View style={styles.infoBadge}><Ionicons name="storefront-outline" size={14} color="#083358" /><Text style={styles.infoText}>{safeText(pedido?.origem || "delivery")}</Text></View>
          {!!pedido?.mesaNumero && <View style={styles.infoBadge}><Ionicons name="restaurant-outline" size={14} color="#083358" /><Text style={styles.infoText}>Mesa {pedido.mesaNumero}</Text></View>}
        </View>

        <View style={styles.itemsBox}>
          {itens.length ? itens.map((it, idx) => {
            const itemCanceled = normalizeStatus(it?.status || it?.cozinha?.status) === "cancelado" || it?.cancelado === true;
            return (
              <View key={`${id}_${idx}`} style={styles.itemRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.itemName, itemCanceled && styles.itemCanceled]} numberOfLines={1}>{itemQty(it)}x {itemName(it)}</Text>
                  {!!safeText(it?.observacao || it?.obs) && <Text style={styles.itemObs} numberOfLines={1}>{safeText(it?.observacao || it?.obs)}</Text>}
                </View>
                {canCancel && !itemCanceled && (
                  <Pressable onPress={() => cancelarItem(pedido, idx, it)} style={styles.itemCancelBtn} disabled={busyId === `${id}_${idx}`}>
                    {busyId === `${id}_${idx}` ? <ActivityIndicator size="small" /> : <Ionicons name="close" size={16} color="#ef4444" />}
                  </Pressable>
                )}
              </View>
            );
          }) : <Text style={styles.emptyItem}>Sem itens detalhados.</Text>}
        </View>

        {canCancel && (
          <Pressable onPress={() => cancelarPedido(pedido)} disabled={busyId === id} style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.86 }]}>
            {busyId === id ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash-outline" size={16} color="#fff" />}
            <Text style={styles.cancelText}>Cancelar pedido</Text>
          </Pressable>
        )}
      </View>
    );
  };

  const pulseStyle = {
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }],
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] }),
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={headerGradient} style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => navigation.goBack()} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.hTitle}>Pedidos</Text>
            <Text style={styles.hSub} numberOfLines={1}>{isOnline ? "Fila em tempo real do atendimento" : "Offline: exibindo cache local"}</Text>
          </View>
          <Animated.View style={[styles.iconBadge, pulseStyle]}>
            <Ionicons name="receipt-outline" size={18} color="#fff" />
          </Animated.View>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}><Text style={styles.kpiValue}>{stats.ativos}</Text><Text style={styles.kpiLabel}>ativos</Text></View>
          <View style={styles.kpiCard}><Text style={styles.kpiValue}>{stats.producao}</Text><Text style={styles.kpiLabel}>produção</Text></View>
          <View style={styles.kpiCard}><Text style={styles.kpiValue}>{money(stats.totalListado)}</Text><Text style={styles.kpiLabel}>total listado</Text></View>
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentInner}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={17} color="#92400e" />
            <Text style={styles.offlineText}>Sem internet: lista carregada do cache. Ao estabilizar, os pedidos são atualizados com o servidor.</Text>
          </View>
        )}

        <View style={styles.searchCard}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#64748b" />
            <TextInput
              value={busca}
              onChangeText={setBusca}
              placeholder="Buscar por pedido, cliente, mesa..."
              placeholderTextColor="#94a3b8"
              style={styles.searchInput}
            />
            {!!busca && <Pressable onPress={() => setBusca("")}><Ionicons name="close-circle" size={18} color="#94a3b8" /></Pressable>}
          </View>
          <Text style={styles.updatedText}>{lastUpdatedAt ? `Atualizado ${fmtDate(lastUpdatedAt)}${fromCache ? " • cache" : ""} • ${isoToBrDate(dataAplicada)}` : "Sincronizando..."}</Text>
          <View style={styles.dateRow}>
            <View style={styles.dateInputBox}>
              <Ionicons name="calendar-outline" size={17} color="#64748b" />
              <TextInput
                value={dataFiltro}
                onChangeText={setDataFiltro}
                placeholder="DD/MM/AAAA"
                placeholderTextColor="#94a3b8"
                keyboardType="numbers-and-punctuation"
                style={styles.dateInput}
              />
            </View>
            <Pressable onPress={aplicarData} style={styles.dateBtn}><Text style={styles.dateBtnText}>Buscar</Text></Pressable>
            <Pressable onPress={voltarParaHoje} style={styles.todayBtn}><Text style={styles.todayBtnText}>Hoje</Text></Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {STATUS_ORDER.filter((st) => st === "todos" || counts[st]).map((st) => {
            const active = filtro === st;
            return (
              <Pressable key={st} onPress={() => setFiltro(st)} style={[styles.filterChip, active && styles.filterChipActive]}>
                <Text style={[styles.filterText, active && styles.filterTextActive]}>{st === "todos" ? "Todos" : statusLabel(st)}</Text>
                <Text style={[styles.filterCount, active && styles.filterTextActive]}>{counts[st] || 0}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingBox}><ActivityIndicator size="large" /><Text style={styles.loadingText}>Carregando pedidos...</Text></View>
        ) : pedidosFiltrados.length ? (
          pedidosFiltrados.map(renderPedido)
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons name="receipt-outline" size={34} color="#94a3b8" />
            <Text style={styles.emptyTitle}>Nenhum pedido encontrado</Text>
            <Text style={styles.emptySub}>Puxe para atualizar ou ajuste os filtros.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1220" },
  header: { paddingTop: 54, paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { width: 42, height: 42, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  iconBadge: { width: 42, height: 42, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  hTitle: { color: "#fff", fontSize: 20, fontWeight: "900", letterSpacing: -0.4 },
  hSub: { color: "rgba(255,255,255,0.86)", marginTop: 2, fontWeight: "700" },
  kpiRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  kpiCard: { flex: 1, minHeight: 70, padding: 12, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)" },
  kpiValue: { color: "#fff", fontSize: 18, fontWeight: "900" },
  kpiLabel: { color: "rgba(255,255,255,0.78)", marginTop: 4, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  content: { flex: 1, backgroundColor: "#f4f7fb" },
  contentInner: { padding: 16, paddingBottom: 34 },
  offlineBanner: { marginBottom: 12, padding: 12, borderRadius: 20, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", flexDirection: "row", gap: 9, alignItems: "flex-start" },
  offlineText: { flex: 1, color: "#92400e", fontWeight: "800", lineHeight: 18, fontSize: 12 },
  searchCard: { borderRadius: 24, padding: 12, backgroundColor: "rgba(255,255,255,0.96)", borderWidth: 1, borderColor: "rgba(15,23,42,0.08)", shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 18, elevation: 3 },
  searchBox: { height: 46, borderRadius: 17, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "rgba(15,23,42,0.08)", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, color: "#0f172a", fontWeight: "700" },
  updatedText: { marginTop: 9, color: "#64748b", fontWeight: "700", fontSize: 12 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  dateInputBox: { flex: 1, height: 42, borderRadius: 15, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "rgba(15,23,42,0.08)", paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  dateInput: { flex: 1, color: "#0f172a", fontWeight: "800" },
  dateBtn: { height: 42, paddingHorizontal: 13, borderRadius: 15, backgroundColor: "#083358", alignItems: "center", justifyContent: "center" },
  dateBtnText: { color: "#fff", fontWeight: "900" },
  todayBtn: { height: 42, paddingHorizontal: 12, borderRadius: 15, backgroundColor: "#eef6ff", alignItems: "center", justifyContent: "center" },
  todayBtnText: { color: "#083358", fontWeight: "900" },
  filtersRow: { gap: 8, paddingVertical: 14 },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, height: 38, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(15,23,42,0.08)" },
  filterChipActive: { backgroundColor: "#083358", borderColor: "#083358" },
  filterText: { color: "#334155", fontWeight: "900" },
  filterTextActive: { color: "#fff" },
  filterCount: { color: "#64748b", fontWeight: "900" },
  card: { marginBottom: 12, borderRadius: 24, padding: 14, backgroundColor: "rgba(255,255,255,0.97)", borderWidth: 1, borderColor: "rgba(15,23,42,0.08)", shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 18, elevation: 3 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  orderTitle: { color: "#0f172a", fontWeight: "900", fontSize: 17, letterSpacing: -0.2 },
  orderSub: { color: "#64748b", marginTop: 3, fontWeight: "700" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(255,59,138,0.10)" },
  statusText: { color: "#ff3b8a", fontWeight: "900", fontSize: 12 },
  statusCancelado: { backgroundColor: "#fee2e2" },
  statusCanceladoText: { color: "#ef4444" },
  infoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  infoBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 32, borderRadius: 999, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "rgba(15,23,42,0.06)" },
  infoText: { color: "#083358", fontWeight: "900", fontSize: 12 },
  itemsBox: { marginTop: 12, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: "rgba(15,23,42,0.06)" },
  itemRow: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#f8fafc", flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, borderBottomColor: "rgba(15,23,42,0.05)" },
  itemName: { color: "#0f172a", fontWeight: "800" },
  itemCanceled: { color: "#94a3b8", textDecorationLine: "line-through" },
  itemObs: { color: "#64748b", marginTop: 2, fontSize: 12, fontWeight: "600" },
  itemCancelBtn: { width: 30, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#fee2e2" },
  emptyItem: { padding: 12, color: "#64748b", fontWeight: "700" },
  cancelBtn: { marginTop: 12, height: 42, borderRadius: 15, backgroundColor: "#ef4444", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  cancelText: { color: "#fff", fontWeight: "900" },
  loadingBox: { alignItems: "center", padding: 30 },
  loadingText: { marginTop: 10, color: "#64748b", fontWeight: "800" },
  emptyBox: { marginTop: 16, padding: 28, alignItems: "center", borderRadius: 24, backgroundColor: "#fff", borderWidth: 1, borderColor: "rgba(15,23,42,0.08)" },
  emptyTitle: { marginTop: 10, color: "#0f172a", fontWeight: "900", fontSize: 16 },
  emptySub: { marginTop: 4, color: "#64748b", fontWeight: "700" },
});
