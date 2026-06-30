// src/screens/MesasScreen.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  RefreshControl,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";

import { api } from "../api/api";
import { getSession, clearSession } from "../api/storage/session";
import { connectSocket, getSocket } from "../socket/socket";

// ✅ NOVO: tema (gradiente do header)
import { useAppTheme } from "../theme/ThemeProvider";

/* -----------------------
   Helpers permanência
-------------------------*/
const fmtMin = (date) => {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return null;

  const diffMin = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin} min`;

  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return `${h}h${m ? ` ${m}m` : ""}`;
};

const fmtDur = (sec) => {
  const s = Number(sec);
  if (!Number.isFinite(s) || s <= 0) return null;

  const totalMin = Math.floor(s / 60);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;

  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m ? ` ${m}m` : ""}`;
};

const avgNowMin = (mesas) => {
  const ocupadas = mesas.filter((m) => m.status === "ocupada" && m.ocupadaDesde);
  if (ocupadas.length === 0) return null;

  const totalMs = ocupadas.reduce((acc, m) => {
    const t = new Date(m.ocupadaDesde).getTime();
    return acc + (Number.isFinite(t) ? Date.now() - t : 0);
  }, 0);

  const avgMs = totalMs / ocupadas.length;
  const min = Math.max(0, Math.floor(avgMs / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return `${h}h${mm ? ` ${mm}m` : ""}`;
};

// ✅ detecta se é erro de bloqueio/desativado
const isAuthBlock = (err) => {
  const st = err?.response?.status;
  const msg =
    err?.response?.data?.message ||
    err?.response?.data?.mensagem ||
    err?.message ||
    "";

  const s = String(msg).toLowerCase();

  // Não derruba sessão só porque uma rota retornou 401/403.
  // Isso estava causando: Login -> Home -> Login.
  // Só força logout em casos realmente definitivos.
  if (s.includes("garçom desativado") || s.includes("garcom desativado")) return true;
  if (s.includes("token inválido") || s.includes("token invalido")) return true;
  if (s.includes("token expirado") || s.includes("jwt expired")) return true;
  if (s.includes("jwt malformed") || s.includes("invalid token")) return true;

  return false;
};

// ✅ permissões
const canAbrirMesaFromSession = (session) =>
  session?.garcom?.permissoes?.abrirMesa === true;

const pickRestauranteIdFromSession = (session) =>
  session?.restaurante?._id || session?.restaurante?.id || session?.restaurante?.restauranteId || null;

const CAIXA_ATUAL_ENDPOINT = (restauranteId) => `/api/caixa/${restauranteId}/atual`;

export default function MesasScreen({ navigation }) {
  const { headerGradient } = useAppTheme(); // ✅ NOVO

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mesas, setMesas] = useState([]);
  const [busca, setBusca] = useState("");
  const [restauranteNome, setRestauranteNome] = useState("");
  const [filtro, setFiltro] = useState("todas"); // todas | ocupadas | livres

  // ✅ abrir mesa modal
  const [openModal, setOpenModal] = useState(false);
  const [mesaSelecionada, setMesaSelecionada] = useState(null);
  const [nomeCliente, setNomeCliente] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  // ✅ sons
  const [soundsReady, setSoundsReady] = useState(false);

  // ✅ permissões
  const [perms, setPerms] = useState({});

  // ✅ tick para “tempo em tempo real”
  const [tick, setTick] = useState(0);

  // ✅ animação / badge
  const lastUpdateRef = useRef(new Map()); // mesaId -> ts
  const pulseRef = useRef(new Map()); // mesaId -> Animated.Value

  const soundOpenRef = useRef(null);
  const soundItemRef = useRef(null);

  // ✅ anti-spam (principalmente pro item_in)
  const lastSoundTsRef = useRef({ open: 0, item: 0 });

  // habilita LayoutAnimation no Android
  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  // ✅ timer real-time
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  // ✅ carrega sons uma vez
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { sound: openS } = await Audio.Sound.createAsync(
          require("../../assets/sounds/table_open.mp3"),
          { shouldPlay: false, volume: 0.9 }
        );

        const { sound: itemS } = await Audio.Sound.createAsync(
          require("../../assets/sounds/item_in.mp3"),
          { shouldPlay: false, volume: 0.9 }
        );

        if (!mounted) {
          await openS.unloadAsync();
          await itemS.unloadAsync();
          return;
        }

        soundOpenRef.current = openS;
        soundItemRef.current = itemS;

        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });

        setSoundsReady(true);
        console.log("✅ Sons carregados");
      } catch (e) {
        console.warn("❌ Som não carregado:", e);
        setSoundsReady(false);
      }
    })();

    return () => {
      mounted = false;
      soundOpenRef.current?.unloadAsync?.();
      soundItemRef.current?.unloadAsync?.();
    };
  }, []);

  const playSound = async (which) => {
    try {
      if (!soundsReady) return;

      // cooldown pra evitar spam / falhas por concorrência
      const now = Date.now();
      const cooldownMs = which === "item" ? 450 : 250;
      if (now - (lastSoundTsRef.current[which] || 0) < cooldownMs) return;
      lastSoundTsRef.current[which] = now;

      const s = which === "open" ? soundOpenRef.current : soundItemRef.current;
      if (!s) return;

      // ✅ para SFX, isso é o mais confiável (reinicia do começo)
      if (typeof s.replayAsync === "function") {
        await s.replayAsync();
        return;
      }

      // fallback
      try {
        await s.stopAsync();
      } catch {}
      await s.setPositionAsync(0);
      await s.playAsync();
    } catch (e) {
      console.warn("❌ Falha ao tocar som:", which, e?.message);
    }
  };

  const markUpdated = (mesaId) => {
    lastUpdateRef.current.set(mesaId, Date.now());

    let v = pulseRef.current.get(mesaId);
    if (!v) {
      v = new Animated.Value(0);
      pulseRef.current.set(mesaId, v);
    }
    v.setValue(0);

    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  };

  const isUpdatedNow = (mesaId, ms = 7000) => {
    const ts = lastUpdateRef.current.get(mesaId);
    return !!ts && Date.now() - ts <= ms;
  };

  const forceLogout = async (message) => {
    try {
      await clearSession();
    } catch {}
    if (message) Alert.alert("Acesso bloqueado", message);
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  const loadPerms = async () => {
    try {
      const session = await getSession();
      const p = session?.garcom?.permissoes;
      setPerms(p && typeof p === "object" ? p : {});
    } catch {
      setPerms({});
    }
  };

  const canOpenMesaUI = useMemo(() => perms?.abrirMesa === true, [perms]);

  const fetchMesas = async () => {
    try {
      const session = await getSession();

      // nome no header
      setRestauranteNome(session?.restaurante?.nome || "");

      // ✅ atualiza perms junto (evita ficar “antiga”)
      const p = session?.garcom?.permissoes;
      setPerms(p && typeof p === "object" ? p : {});

      const res = await api.get(`/api/garcons/app/mesas`);
      const list = Array.isArray(res.data) ? res.data : [];
      setMesas(list);
    } catch (err) {
      if (isAuthBlock(err)) {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.mensagem ||
          "Seu acesso foi bloqueado. Faça login novamente.";
        await forceLogout(msg);
        return;
      }

      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.mensagem ||
        "Erro ao listar mesas.";
      Alert.alert("Erro", msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadPerms();
    fetchMesas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // socket
  useEffect(() => {
    let socket;

    (async () => {
      const session = await getSession();
      const restauranteId = session?.restaurante?._id;
      if (!restauranteId) return;

      socket = connectSocket(restauranteId);

      socket.on("mesaAtualizada", (mesaAtualizada) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

        setMesas((prev) => {
          const old = prev.find((m) => m._id === mesaAtualizada._id);
          const oldStatus = old?.status;
          const newStatus = mesaAtualizada?.status;

          markUpdated(mesaAtualizada._id);

          if (oldStatus && oldStatus !== "ocupada" && newStatus === "ocupada") {
            playSound("open");
          }

          const exists = !!old;
          return exists
            ? prev.map((m) => (m._id === mesaAtualizada._id ? mesaAtualizada : m))
            : [...prev, mesaAtualizada];
        });
      });

      socket.on("pedidoAtualizado", (pedido) => {
        const mesaId = pedido?.mesaId;
        if (mesaId) markUpdated(String(mesaId));
        playSound("item");
      });

      socket.on("novoPedido", (pedido) => {
        const mesaId = pedido?.mesaId;
        if (mesaId) markUpdated(String(mesaId));
        playSound("open");
      });

      socket.on("mesaCriada", (mesaNova) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMesas((prev) => [...prev, mesaNova]);
        if (mesaNova?._id) markUpdated(mesaNova._id);
      });

      socket.on("mesaExcluida", ({ id }) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMesas((prev) => prev.filter((m) => m._id !== id));
      });
    })();

    return () => {
      const s = getSocket();
      s?.off("mesaAtualizada");
      s?.off("pedidoAtualizado");
      s?.off("novoPedido");
      s?.off("mesaCriada");
      s?.off("mesaExcluida");
    };
  }, [soundsReady]); // <- garante que playSound use o estado atual

  const contagem = useMemo(() => {
    const total = mesas.length;
    const ocupadas = mesas.filter((m) => m.status === "ocupada").length;
    const livres = total - ocupadas;
    return { total, ocupadas, livres };
  }, [mesas]);

  const mesasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();

    let base = mesas;
    if (filtro === "ocupadas") base = base.filter((m) => m.status === "ocupada");
    if (filtro === "livres") base = base.filter((m) => m.status !== "ocupada");

    if (q) base = base.filter((m) => String(m.numero || "").toLowerCase().includes(q));

    const toNum = (v) => {
      const n = parseInt(String(v || "").replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? n : 999999;
    };

    return [...base].sort((a, b) => {
      const ao = a.status === "ocupada" ? 0 : 1;
      const bo = b.status === "ocupada" ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return toNum(a.numero) - toNum(b.numero);
    });
  }, [busca, mesas, filtro]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchMesas();
  };

  const verComanda = (mesa) => {
    navigation.navigate("Comanda", {
      mesaId: mesa._id,
      mesaNumero: mesa.numero,
    });
  };

  const abrirMesa = (mesa) => {
    setMesaSelecionada(mesa);
    setNomeCliente("");
    setOpenModal(true);
  };

  const garantirCaixaAberto = async (sessionAtual = null) => {
    const session = sessionAtual || await getSession();
    const rid = pickRestauranteIdFromSession(session);
    if (!rid) return true;
    try {
      const res = await api.get(CAIXA_ATUAL_ENDPOINT(rid));
      const data = res?.data || {};
      const caixa = data?.caixa || data?.sessao || data;
      const aberto = data?.aberto === true || String(caixa?.status || "").toLowerCase() === "aberto" || !!caixa?.aberto;
      if (aberto) return true;
      Alert.alert("Caixa fechado", "Abra o caixa no Hub-Restaurante antes de abrir mesa.");
      return false;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        Alert.alert("Caixa fechado", "Abra o caixa no Hub-Restaurante antes de abrir mesa.");
        return false;
      }
      Alert.alert("Caixa", err?.response?.data?.message || err?.response?.data?.mensagem || "Não consegui confirmar se o caixa está aberto.");
      return false;
    }
  };

  // ✅ gate único pra abrir mesa (recarrega sessão na hora do clique)
  const handleMesaPress = async (mesa) => {
    const ocupada = mesa?.status === "ocupada";
    if (ocupada) return verComanda(mesa);

    const session = await getSession();
    const allowed = canAbrirMesaFromSession(session);

    if (!allowed) {
      Alert.alert("Sem permissão", "Você não tem permissão para abrir mesa.");
      return;
    }

    if (!(await garantirCaixaAberto(session))) return;

    abrirMesa(mesa);
  };

  const confirmarAbrirMesa = async () => {
    if (!mesaSelecionada?._id) return;

    // ✅ trava também aqui (segurança extra)
    const session = await getSession();
    const allowed = canAbrirMesaFromSession(session);
    if (!allowed) {
      Alert.alert("Sem permissão", "Você não tem permissão para abrir mesa.");
      setOpenModal(false);
      return;
    }

    if (!(await garantirCaixaAberto(session))) {
      setOpenModal(false);
      return;
    }

    setAbrindo(true);
    try {
      const res = await api.post(
        `/api/garcons/app/mesa/${mesaSelecionada._id}/abrir`,
        {
          nomeCliente: nomeCliente?.trim() || `Mesa ${mesaSelecionada.numero}`,
        }
      );

      const mesaAtualizada = res?.data?.mesa;
      const pedido = res?.data?.pedido;

      setOpenModal(false);
      playSound("open");

      await fetchMesas();

      navigation.navigate("Comanda", {
        mesaId: mesaAtualizada?._id || mesaSelecionada._id,
        mesaNumero: mesaAtualizada?.numero || mesaSelecionada.numero,
        pedidoId: pedido?._id,
      });
    } catch (err) {
      if (isAuthBlock(err)) {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.mensagem ||
          "Seu acesso foi bloqueado. Faça login novamente.";
        await forceLogout(msg);
        return;
      }

      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.mensagem ||
        "Erro ao abrir mesa.";
      Alert.alert("Erro", msg);
    } finally {
      setAbrindo(false);
    }
  };

  const FilterChip = ({ label, value, icon }) => {
    const active = filtro === value;
    return (
      <Pressable
        onPress={() => setFiltro(value)}
        style={({ pressed }) => [
          styles.filterChip,
          active && styles.filterChipActive,
          pressed && { opacity: 0.92 },
        ]}
      >
        <Ionicons
          name={icon}
          size={15}
          color={active ? "#0f172a" : "rgba(255,255,255,0.92)"}
        />
        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const MesaCard = ({ mesa }) => {
    const ocupada = mesa.status === "ocupada";
    // eslint-disable-next-line no-unused-vars
    const _ = tick;

    const tempoOcupada = fmtMin(mesa.ocupadaDesde);
    const ultimaDur = fmtDur(mesa.ultimaPermanenciaSegundos);

    const subt = ocupada
      ? `Comanda ativa${tempoOcupada ? ` • há ${tempoOcupada}` : ""}`
      : `Sem comanda${ultimaDur ? ` • última: ${ultimaDur}` : ""}`;

    const pulse = pulseRef.current.get(mesa._id) || new Animated.Value(0);
    const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

    const showUpdated = isUpdatedNow(mesa._id);
    const abrirDisabled = !ocupada && !canOpenMesaUI;

    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={() => handleMesaPress(mesa)}
          style={({ pressed }) => [
            styles.card,
            showUpdated && styles.cardUpdated,
            pressed && { opacity: 0.94 },
            abrirDisabled && { opacity: 0.72 },
          ]}
        >
          <View style={styles.cardTop}>
            <View style={[styles.badge, ocupada ? styles.badgeOcupada : styles.badgeLivre]}>
              <Ionicons
                name={ocupada ? "flame-outline" : "checkmark-circle-outline"}
                size={14}
                color={ocupada ? "#b91c1c" : "#15803d"}
              />
              <Text
                style={[
                  styles.badgeText,
                  ocupada ? styles.badgeTextRed : styles.badgeTextGreen,
                ]}
              >
                {ocupada ? "OCUPADA" : "LIVRE"}
              </Text>

              {showUpdated && (
                <View style={styles.updatedPill}>
                  <Ionicons name="flash-outline" size={12} color="#a16207" />
                  <Text style={styles.updatedText}>agora</Text>
                </View>
              )}
            </View>

            <Pressable
              onPress={(e) => {
                e?.stopPropagation?.();
                handleMesaPress(mesa);
              }}
              disabled={abrirDisabled}
              style={({ pressed }) => [
                styles.ctaPill,
                ocupada ? styles.ctaPillOcupada : styles.ctaPillLivre,
                abrirDisabled && { opacity: 0.45 },
                pressed && { opacity: 0.92 },
              ]}
            >
              <Ionicons
                name={ocupada ? "receipt-outline" : "add-circle-outline"}
                size={16}
                color={ocupada ? "#b91c1c" : "#15803d"}
              />
              <Text style={[styles.ctaText, ocupada ? styles.ctaTextRed : styles.ctaTextGreen]}>
                {ocupada ? "Ver comanda" : abrirDisabled ? "Sem permissão" : "Abrir"}
              </Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={styles.cardIcon}>
              <Ionicons name="grid-outline" size={18} color="#ff3b8a" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{mesa.numero}</Text>
              <Text style={styles.cardSub}>
                {subt}
                {mesa.pedidoAtualId ? ` • Pedido: ${String(mesa.pedidoAtualId).slice(-6)}` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={styles.root}>
      {/* ✅ AGORA USA O GRADIENTE DO TEMA */}
      <LinearGradient colors={headerGradient} style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.hTitle}>Mesas</Text>
            <Text style={styles.hSub}>{restauranteNome ? restauranteNome : "Restaurante"}</Text>
          </View>

          <Pressable
            onPress={() => {
              setRefreshing(true);
              fetchMesas();
            }}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricPill}>
            <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.95)" />
            <Text style={styles.metricText}>Média agora: {avgNowMin(mesas) || "--"}</Text>
          </View>

          <View style={styles.metricPill}>
            <Ionicons name="shield-checkmark-outline" size={14} color="rgba(255,255,255,0.95)" />
            <Text style={styles.metricText}>
              Abrir mesa: {canOpenMesaUI ? "Liberado" : "Bloqueado"}
            </Text>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="rgba(15,23,42,0.55)" />
          <TextInput
            value={busca}
            onChangeText={setBusca}
            placeholder="Buscar mesa (ex: 12, Mesa 5)"
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
          />
          {!!busca && (
            <Pressable onPress={() => setBusca("")}>
              <Ionicons name="close-circle" size={18} color="rgba(15,23,42,0.45)" />
            </Pressable>
          )}
        </View>

        <View style={styles.filtersRow}>
          <FilterChip icon="apps-outline" label={`Todas (${contagem.total})`} value="todas" />
          <FilterChip icon="flame-outline" label={`Ocupadas (${contagem.ocupadas})`} value="ocupadas" />
          <FilterChip icon="checkmark-circle-outline" label={`Livres (${contagem.livres})`} value="livres" />
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <Text style={styles.loading}>Carregando mesas...</Text>
        ) : mesasFiltradas.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Nenhuma mesa encontrada</Text>
            <Text style={styles.emptySub}>Tente mudar a busca, filtro ou atualize.</Text>
          </View>
        ) : (
          mesasFiltradas.map((m) => <MesaCard key={m._id} mesa={m} />)
        )}
      </ScrollView>

      <Modal
        visible={openModal}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  Abrir {mesaSelecionada?.numero ? `Mesa ${mesaSelecionada.numero}` : "Mesa"}
                </Text>

                <Pressable onPress={() => setOpenModal(false)}>
                  <Ionicons name="close" size={20} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.modalSub}>
                Se quiser, coloque um nome pra identificar a comanda.
              </Text>

              <TextInput
                value={nomeCliente}
                onChangeText={setNomeCliente}
                placeholder="Ex: João / Família Silva"
                placeholderTextColor="#94a3b8"
                style={styles.modalInput}
              />

              <Pressable
                onPress={confirmarAbrirMesa}
                disabled={abrindo}
                style={({ pressed }) => [styles.primaryBtn, (pressed || abrindo) && { opacity: 0.9 }]}
              >
                {abrindo ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.primaryText}>Abrindo...</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryText}>Abrir mesa</Text>
                )}
              </Pressable>

              <Pressable
                onPress={() => setOpenModal(false)}
                style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.ghostText}>Cancelar</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1220" },
  header: {
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  hTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  hSub: { color: "rgba(255,255,255,0.85)", marginTop: 2 },

  metricsRow: { marginTop: 10, flexDirection: "row", gap: 10, flexWrap: "wrap" },
  metricPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  metricText: { color: "#fff", fontWeight: "900", fontSize: 12 },

  searchWrap: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  searchInput: { flex: 1, fontWeight: "700", color: "#0f172a" },

  filtersRow: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  filterChipActive: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: "rgba(255,255,255,0.95)",
  },
  filterChipText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  filterChipTextActive: { color: "#0f172a" },

  content: {
    padding: 16,
    paddingBottom: 26,
    backgroundColor: "#f3f6fb",
    minHeight: "100%",
  },
  loading: { fontWeight: "800", color: "#0f172a", marginTop: 10 },

  card: {
    marginTop: 10,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
  },
  cardUpdated: {
    borderColor: "rgba(245,158,11,0.55)",
    shadowColor: "#f59e0b",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeLivre: { backgroundColor: "rgba(34,197,94,0.12)" },
  badgeOcupada: { backgroundColor: "rgba(239,68,68,0.12)" },
  badgeText: { fontWeight: "900", fontSize: 11 },
  badgeTextRed: { color: "#b91c1c" },
  badgeTextGreen: { color: "#15803d" },

  updatedPill: {
    marginLeft: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  updatedText: { fontWeight: "900", fontSize: 11, color: "#a16207" },

  ctaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  ctaPillLivre: {
    backgroundColor: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.25)",
  },
  ctaPillOcupada: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderColor: "rgba(239,68,68,0.25)",
  },
  ctaText: { fontWeight: "900", fontSize: 12 },
  ctaTextGreen: { color: "#15803d" },
  ctaTextRed: { color: "#b91c1c" },

  cardIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(255,59,138,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontWeight: "900", color: "#0f172a", fontSize: 15 },
  cardSub: { marginTop: 2, color: "#64748b", fontWeight: "700", fontSize: 12 },

  emptyBox: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
  },
  emptyTitle: { fontWeight: "900", color: "#0f172a" },
  emptySub: { marginTop: 6, color: "#64748b", fontWeight: "700" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    padding: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.10)",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { fontWeight: "900", fontSize: 16, color: "#0f172a" },
  modalSub: { marginTop: 8, color: "#64748b", fontWeight: "700" },
  modalInput: {
    marginTop: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontWeight: "800",
    color: "#0f172a",
  },

  primaryBtn: {
    marginTop: 14,
    backgroundColor: "#ff3b8a",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#ff3b8a",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryText: { color: "#fff", fontWeight: "900" },

  ghostBtn: {
    marginTop: 10,
    backgroundColor: "#fff",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.10)",
  },
  ghostText: { fontWeight: "900", color: "#0f172a" },
});
