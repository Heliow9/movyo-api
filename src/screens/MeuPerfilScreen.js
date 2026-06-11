// src/screens/MeuPerfilScreen.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

import { api } from "../api/api";
import { clearSession, getSession, updateSessionGarcomPatch } from "../api/storage/session";

// ✅ NOVO
import { useAppTheme } from "../theme/ThemeProvider";
import { THEME_PRESETS } from "../theme/palettes";

function bool(v) {
  return v === true;
}

function Chip({ icon, text, tone = "neutral" }) {
  return (
    <View
      style={[
        styles.chip,
        tone === "good" && styles.chipGood,
        tone === "bad" && styles.chipBad,
      ]}
    >
      <Ionicons
        name={icon}
        size={14}
        color={tone === "good" ? "#16a34a" : tone === "bad" ? "#ef4444" : "#0f172a"}
      />
      <Text style={styles.chipText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function LabelRow({ icon, label, value, onCopy }) {
  const disabled = !value;

  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={16} color="#ff3b8a" />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.rowValue} numberOfLines={1} ellipsizeMode="tail">
            {value ?? "-"}
          </Text>
        </View>
      </View>

      {!!onCopy && (
        <Pressable
          disabled={disabled}
          onPress={onCopy}
          style={({ pressed }) => [
            styles.copyBtn,
            pressed && !disabled && { opacity: 0.85 },
            disabled && { opacity: 0.4 },
          ]}
        >
          <Ionicons name="copy-outline" size={16} color="#0f172a" />
        </Pressable>
      )}
    </View>
  );
}

function PermChip({ label, on }) {
  return (
    <View style={[styles.permItem, on ? styles.permOn : styles.permOff]}>
      <Ionicons
        name={on ? "checkmark-circle" : "close-circle"}
        size={16}
        color={on ? "#16a34a" : "#ef4444"}
      />
      <Text style={styles.permText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <View style={{ marginTop: 14 }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {!!subtitle && (
          <Text style={styles.sectionSub} numberOfLines={2} ellipsizeMode="tail">
            {subtitle}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

export default function MeuPerfilScreen({ navigation, onLogout }) {
  // ✅ NOVO: tema global
  const { presetId, headerGradient, setPreset } = useAppTheme();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadFromStorage = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const s = await getSession?.();
      setSession(s || null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFromStorage({ silent: false });
  }, [loadFromStorage]);

  const garcom = session?.garcom || null;
  const restaurante = session?.restaurante || null;

  const nome = garcom?.apelido || garcom?.nome || "Garçom";
  const ativo = garcom?.ativo !== false;

  // ✅ Permissões REAIS do seu backend
  const permissoes = useMemo(() => {
    const p = garcom?.permissoes && typeof garcom.permissoes === "object" ? garcom.permissoes : {};

    const grupos = [
      {
        title: "Mesas",
        items: [
          { key: "verMesas", label: "Ver mesas" },
          { key: "abrirMesa", label: "Abrir mesa" },
        ],
      },
      {
        title: "Comandas",
        items: [{ key: "verComanda", label: "Ver comanda" }],
      },
      {
        title: "Pedidos",
        items: [
          { key: "verPedidos", label: "Ver pedidos" },
          { key: "adicionarItem", label: "Adicionar item" },
          { key: "cancelarPedido", label: "Cancelar pedido" },
        ],
      },
      {
        title: "Financeiro",
        items: [{ key: "fecharConta", label: "Fechar conta" }],
      },
    ];

    const flat = grupos.flatMap((g) => g.items);
    const total = flat.length;
    const onCount = flat.reduce((acc, it) => acc + (p?.[it.key] === true ? 1 : 0), 0);

    return { p, grupos, total, onCount };
  }, [garcom]);

  // ✅ Atualiza REAL do backend e sincroniza no AsyncStorage
  const refreshFromBackend = useCallback(async () => {
    try {
      setRefreshing(true);

      const r = await api.get("/api/garcons/app/me");
      const data = r?.data || {};
      const g = data?.garcom;

      if (!g?._id) {
        throw new Error("Servidor não retornou o perfil do garçom.");
      }

      const merged = await updateSessionGarcomPatch({
        _id: g._id,
        nome: g.nome,
        apelido: g.apelido,
        telefone: g.telefone,
        ativo: g.ativo,
        permissoes: g.permissoes || {},
      });

      setSession(merged || null);

      Alert.alert("Atualizado ✅", "Dados sincronizados com o servidor.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.mensagem ||
        e?.message ||
        "Não foi possível atualizar agora.";
      Alert.alert("Ops", msg);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onRefresh = () => refreshFromBackend();

  const copy = async (label, value) => {
    try {
      if (!value) return;
      await Clipboard.setStringAsync(String(value));
      Alert.alert("Copiado ✅", `${label} copiado para a área de transferência.`);
    } catch {
      Alert.alert("Ops", "Não foi possível copiar.");
    }
  };

  const logoutNow = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    try {
      await clearSession();
      setSession(null);
    } catch (e) {
      console.log("logout erro:", e?.message);
    } finally {
      setLoggingOut(false);
      onLogout?.();
    }
  };

  const logout = () => {
    Alert.alert("Sair", "Deseja encerrar sua sessão?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: logoutNow },
    ]);
  };

  const applyPalette = async (id) => {
    if (id === presetId) return;
    await setPreset(id);
    Alert.alert("Tema aplicado ✅", "A paleta foi atualizada no app.");
  };

  return (
    <View style={styles.root}>
      {/* ✅ Header agora usa gradiente do tema */}
      <LinearGradient colors={headerGradient} style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              Meu perfil
            </Text>
            <Text style={styles.subTitle} numberOfLines={1}>
              {restaurante?.nome || "Movyo Garçom"}
            </Text>
          </View>

          <Pressable
            onPress={logout}
            disabled={loggingOut}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && !loggingOut && { opacity: 0.85 },
              loggingOut && { opacity: 0.75 },
            ]}
          >
            {loggingOut ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="log-out-outline" size={18} color="#fff" />
            )}
          </Pressable>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={18} color="#fff" />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {loading ? "Carregando..." : nome}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {garcom?.telefone ? `Tel: ${garcom.telefone}` : "Sem telefone"}
            </Text>

            <View style={styles.chipsRow}>
              <Chip
                icon={ativo ? "checkmark-circle-outline" : "close-circle-outline"}
                tone={ativo ? "good" : "bad"}
                text={ativo ? "Ativo" : "Inativo"}
              />
              <Chip
                icon="shield-checkmark-outline"
                text={`${permissoes.onCount}/${permissoes.total} permissões`}
              />
            </View>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={refreshFromBackend}
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.9 }]}
          >
            <Ionicons name="refresh" size={14} color="#0f172a" />
            <Text style={styles.pillText}>
              {refreshing ? "Atualizando..." : "Atualizar"}
            </Text>
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Dados" subtitle="Informações do seu login e do restaurante.">
          <View style={styles.box}>
            <LabelRow
              icon="id-card-outline"
              label="ID do garçom"
              value={garcom?._id}
              onCopy={() => copy("ID do garçom", garcom?._id)}
            />
            <LabelRow icon="call-outline" label="Telefone" value={garcom?.telefone} />
            <LabelRow
              icon="storefront-outline"
              label="ID do restaurante"
              value={restaurante?._id}
              onCopy={() => copy("ID do restaurante", restaurante?._id)}
            />
            <LabelRow
              icon="pricetag-outline"
              label="Slug"
              value={restaurante?.slugIdentificador}
              onCopy={() => copy("Slug", restaurante?.slugIdentificador)}
            />
          </View>
        </Section>

        {/* ✅ NOVO: Paleta de cores */}
        <Section
          title="Aparência"
          subtitle="Escolha uma paleta de cores para o gradiente do cabeçalho."
        >
          <View style={styles.paletteGrid}>
            {THEME_PRESETS.map((p) => {
              const selected = p.id === presetId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => applyPalette(p.id)}
                  style={({ pressed }) => [
                    styles.paletteCard,
                    selected && styles.paletteCardSelected,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <LinearGradient colors={p.colors} style={styles.paletteSwatch} />
                  <View style={styles.paletteMeta}>
                    <Text style={styles.paletteName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
                    ) : (
                      <Ionicons name="color-palette-outline" size={18} color="#64748b" />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.paletteHint} numberOfLines={2}>
            Dica: essa configuração fica salva no aparelho do usuário (não depende do servidor).
          </Text>
        </Section>

        <Section
          title="Permissões"
          subtitle="O que você pode fazer no app (controlado pelo restaurante)."
        >
          {permissoes.grupos.map((g) => (
            <View key={g.title} style={styles.groupBox}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{g.title}</Text>
                <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
              </View>

              <View style={styles.permsWrap}>
                {g.items.map((item) => (
                  <PermChip key={item.key} label={item.label} on={bool(permissoes.p?.[item.key])} />
                ))}
              </View>
            </View>
          ))}
        </Section>

        <View style={{ marginTop: 18 }}>
          <Pressable
            onPress={logout}
            disabled={loggingOut}
            style={({ pressed }) => [
              styles.logoutCTA,
              pressed && !loggingOut && { opacity: 0.92 },
              loggingOut && { opacity: 0.75 },
            ]}
          >
            {loggingOut ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="log-out-outline" size={18} color="#fff" />
                <Text style={styles.logoutCTAText}>Sair da conta</Text>
              </>
            )}
          </Pressable>

          <Text style={styles.footerHint} numberOfLines={2}>
            Dica: se alguma permissão estiver errada, ajuste no painel do restaurante e toque em
            “Atualizar”.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b1220" },
  header: {
    paddingTop: 54,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  title: { color: "#fff", fontSize: 18, fontWeight: "900" },
  subTitle: { color: "rgba(255,255,255,0.85)", marginTop: 2, fontWeight: "700" },

  profileCard: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  name: { color: "#fff", fontWeight: "900", fontSize: 16 },
  meta: { color: "rgba(255,255,255,0.88)", fontWeight: "700", marginTop: 2 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.95)",
  },
  chipText: { fontWeight: "900", color: "#0f172a", fontSize: 12 },
  chipGood: { backgroundColor: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.22)" },
  chipBad: { backgroundColor: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.20)" },

  headerActions: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.95)",
  },
  pillText: { color: "#0f172a", fontWeight: "900", fontSize: 12 },

  content: {
    padding: 16,
    paddingBottom: 28,
    backgroundColor: "#f3f6fb",
    minHeight: "100%",
  },

  sectionHead: { marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: "#0f172a" },
  sectionSub: { marginTop: 4, color: "#64748b", fontWeight: "700", fontSize: 12 },

  box: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    ...(Platform.OS === "android"
      ? { elevation: 2 }
      : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }),
  },

  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 8 },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 14,
    backgroundColor: "rgba(255,59,138,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { color: "#64748b", fontWeight: "800", fontSize: 12 },
  rowValue: { color: "#0f172a", fontWeight: "900", marginTop: 2 },
  copyBtn: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: "rgba(15,23,42,0.06)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
  },

  // ✅ NOVO: grid da paleta
  paletteGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  paletteCard: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.10)",
    padding: 10,
    ...(Platform.OS === "android"
      ? { elevation: 2 }
      : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }),
  },
  paletteCardSelected: {
    borderColor: "rgba(34,197,94,0.45)",
  },
  paletteSwatch: {
    height: 44,
    borderRadius: 14,
  },
  paletteMeta: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  paletteName: {
    flex: 1,
    minWidth: 0,
    fontWeight: "900",
    color: "#0f172a",
  },
  paletteHint: {
    marginTop: 10,
    color: "#64748b",
    fontWeight: "700",
    fontSize: 12,
  },

  groupBox: {
    marginTop: 10,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    ...(Platform.OS === "android"
      ? { elevation: 2 }
      : { shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }),
  },
  groupHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  groupTitle: { fontWeight: "900", color: "#0f172a" },
  permsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  permItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1 },
  permOn: { backgroundColor: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.22)" },
  permOff: { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.18)" },
  permText: { fontWeight: "900", color: "#0f172a" },

  logoutCTA: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, borderRadius: 18, backgroundColor: "#0f172a" },
  logoutCTAText: { color: "#fff", fontWeight: "900", fontSize: 14 },

  footerHint: { marginTop: 10, color: "#64748b", fontWeight: "700", fontSize: 12, textAlign: "center" },
});
