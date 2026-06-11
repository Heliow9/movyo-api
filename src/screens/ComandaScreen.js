// src/screens/ComandaScreen.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  UIManager,
  Keyboard,
  Image,
  FlatList,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Clipboard from "expo-clipboard";

import { api } from "../api/api";
import { getSession, updateSessionRestaurantePatch } from "../api/storage/session";
import { connectSocket, getSocket } from "../socket/socket";
import { cachedApiGet, cacheSet } from "../utils/smartCache";

import {
  enqueueAddItem,
  flushQueue,
  startQueueWatcher,
  getQueueCountByMesa,
} from "../utils/offlineQueue";

/**
 * ✅ ROTAS (APP GARÇOM):
 * - Produtos: GET /api/produtos/:restauranteId
 * - Comanda:  GET /api/garcons/app/mesa/:mesaId/comanda
 * - Add itens:POST /api/garcons/app/mesa/:mesaId/itens
 * - PIX:      POST /api/garcons/app/mesa/:mesaId/pix
 * (Status opcional: GET /api/garcons/app/mesa/:mesaId/pix)
 */
const buildProdutosEndpoint = (restauranteId) => `/api/produtos/${restauranteId}`;
const RESTAURANTE_GET_ENDPOINT = (rid) => `/api/restaurantes/${rid}`;

// ✅ ROTAS APP (garçom)
const COMANDA_ENDPOINT = (mesaId) => `/api/garcons/app/mesa/${mesaId}/comanda`;
const COMANDA_CACHE_KEY = (mesaId) => `garcom:comanda:${mesaId}`;
const CATALOGO_CACHE_KEY = (restauranteId) => `garcom:catalogo:${restauranteId}`;
const CATALOGO_CACHE_SLUG_KEY = (slug) => `garcom:catalogo:slug:${slug}`;
const ADD_ITENS_ENDPOINT = (mesaId) => `/api/garcons/app/mesa/${mesaId}/itens`;
const PIX_CREATE_ENDPOINT = (mesaId) => `/api/garcons/app/mesa/${mesaId}/pix`;
const PIX_STATUS_ENDPOINT = (mesaId) => `/api/garcons/app/mesa/${mesaId}/pix`;
const FECHAR_MESA_ENDPOINT = (mesaId) => `/api/garcons/app/mesa/${mesaId}/fechar`;
const CAIXA_ATUAL_ENDPOINT = (restauranteId) => `/api/caixa/${restauranteId}/atual`;

const pickRestauranteIdFromSession = (s) =>
  s?.restaurante?._id ||
  s?.restaurante?.id ||
  s?.restaurante?.restauranteId ||
  s?.restaurante?.codigo ||
  null;

const pickRestauranteSlugFromSession = (s) =>
  s?.restaurante?.slugIdentificador ||
  s?.restaurante?.slug ||
  s?.restaurante?.identificador ||
  null;

/* =========================
   HELPERS GERAIS
========================= */
const safeText = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object")
    return String(v.nome || v.title || v.label || v.descricao || v.name || "");
  return "";
};

const money = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const boolLike = (v) => v === true || v === 1 || String(v || "").trim().toLowerCase() === "true";
const normalizePlano = (v) => String(v || "").trim().toLowerCase();
const planoPermiteDinheiroMesa = (plano) => {
  const p = normalizePlano(plano);
  return ["starter-mobile", "full", "premium", "professional", "profissional"].includes(p);
};
const pickMpFromRestaurante = (doc = {}) => {
  const mp = doc?.mercadoPago && typeof doc.mercadoPago === "object" ? doc.mercadoPago : {};
  return {
    conectado: boolLike(mp?.conectado ?? doc?.mercadoPagoConectado ?? doc?.mpConectado),
    hasAccessToken: boolLike(doc?.hasAccessToken ?? doc?.mercadoPagoHasAccessToken ?? mp?.hasAccessToken) || !!mp?.accessToken,
  };
};

const keyNorm = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const arr = (v) => (Array.isArray(v) ? v : []);
const normalizeStr = (s) => safeText(s).trim().toLowerCase();

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

const pickProdutoNome = (p) => safeText(p?.nome || p?.titulo || p?.name || p?.descricao) || "Item";
const getProdutoImagem = (p) => safeText(p?.imagem);
const getProdutoCategoriaTexto = (p) =>
  safeText(
    p?.categoria?.nome ||
      p?.categoriaNome ||
      p?.categoriaLabel ||
      p?.categoria ||
      p?.grupo ||
      p?.tipo ||
      ""
  );

/* =========================
   ✅ RESUMO ITEM
========================= */
const buildResumoItem = (item) => {
  const parts = [];

  if (arr(item?.saboresSelecionados).length)
    parts.push(`Sabores: ${item.saboresSelecionados.join(", ")}`);

  if (item?.bordaSelecionada?.nome) {
    parts.push(
      `Borda: ${item.bordaSelecionada.nome} (+${money(toNum(item.bordaSelecionada.preco))})`
    );
  }

  if (item?.adicionalSelecionado?.nome) {
    parts.push(
      `Adicional: ${item.adicionalSelecionado.nome} (+${money(toNum(item.adicionalSelecionado.preco))})`
    );
  }

  if (arr(item?.complementosSelecionados).length) {
    parts.push(
      `Complementos: ${item.complementosSelecionados
        .map((c) => `${safeText(c?.nome)} (+${money(toNum(c?.preco))})`)
        .filter(Boolean)
        .join(", ")}`
    );
  }

  if (item?.tiposExtrasSelecionados && typeof item.tiposExtrasSelecionados === "object") {
    Object.entries(item.tiposExtrasSelecionados).forEach(([tipo, itens]) => {
      const itensArr = arr(itens);
      if (itensArr.length) {
        parts.push(
          `${safeText(tipo)}: ${itensArr
            .map((i) => `${safeText(i?.nome)} (+${money(toNum(i?.preco))})`)
            .filter(Boolean)
            .join(", ")}`
        );
      }
    });
  }

  if (safeText(item?.observacao)) parts.push(`Obs: ${safeText(item.observacao)}`);

  const full = parts.join(" • ");
  let short = full;
  if (short.length > 95) short = short.slice(0, 95).trim() + "…";

  return { full, short, personalizado: parts.length > 0 };
};

/* =========================
   ✅ NORMALIZADOR PRODUTO (igual WEB)
========================= */
function normalizeProdutoParaConfig(p) {
  if (!p) return null;

  const catNome = (p?.categoria?.nome || p?.categoriaNome || "").toString();
  const catTipo = (p?.categoriaType || p?.categoria?.tipo || p?.categoriaTipo || "").toString();

  const extrasObj = p?.extras && typeof p.extras === "object" ? p.extras : {};
  const extrasKeys = Object.keys(extrasObj || {});

  const extrasMapNorm = new Map();
  for (const k of extrasKeys) extrasMapNorm.set(keyNorm(k), k);

  const saboresDireto = arr(p?.saboresDisponiveis).length ? arr(p?.saboresDisponiveis) : arr(p?.sabores);
  const saboresKeyReal = extrasMapNorm.get("sabores") || extrasMapNorm.get("sabor");

  const saboresFromExtras = saboresKeyReal
    ? arr(extrasObj[saboresKeyReal]).map((x) => ({
        nome: x?.nome ?? x?.label ?? x?.title ?? String(x),
        preco: toNum(x?.preco ?? 0),
      }))
    : [];

  const saboresDisponiveis = saboresDireto.length ? saboresDireto : saboresFromExtras;

  const isPizza =
    keyNorm(catTipo) === "pizza" ||
    keyNorm(catNome).includes("pizza") ||
    (saboresDisponiveis.length > 0 && toNum(p?.maxSabores || 0) > 0);

  const bordasDisponiveis = arr(p?.bordasDisponiveis).length ? arr(p?.bordasDisponiveis) : arr(p?.bordas);
  const adicionais = arr(p?.adicionais).length ? arr(p?.adicionais) : arr(p?.adicional);
  const complementos = arr(p?.complementos);

  const tiposExtrasBase = arr(p?.tiposExtras).map((tipo) => {
    const nomeTipo = tipo?.nome || "";
    const chaveReal = extrasMapNorm.get(keyNorm(nomeTipo));
    const itensFromMap = chaveReal ? arr(extrasObj[chaveReal]) : [];
    const itensDireto = arr(tipo?.itens);
    const itens = itensDireto.length ? itensDireto : itensFromMap;
    return { ...tipo, itens };
  });

  const nomesTiposExistentes = new Set(tiposExtrasBase.map((t) => keyNorm(t?.nome)));
  const extrasIgnorar = new Set(["sabores", "sabor"]);

  const tiposExtrasAuto = extrasKeys
    .filter((k) => {
      const kn = keyNorm(k);
      if (extrasIgnorar.has(kn)) return false;
      if (nomesTiposExistentes.has(kn)) return false;
      return arr(extrasObj[k]).length > 0;
    })
    .map((k) => ({
      nome: k,
      obrigatorio: false,
      tipoSelecion: "multiplo",
      minimoSelecionados: 0,
      maximoSelecionados: undefined,
      itens: arr(extrasObj[k]),
    }));

  const tiposExtras = [...tiposExtrasBase, ...tiposExtrasAuto];

  const precoBase =
    toNum(p?.precoBase) ||
    toNum(p?.preco) ||
    toNum(p?.valor) ||
    toNum(p?.precoUnitario) ||
    toNum(p?.price) ||
    0;

  return {
    ...p,
    _id: p?._id || p?.id,
    nome: pickProdutoNome(p),
    imagem: getProdutoImagem(p),
    descricao: safeText(p?.descricao || p?.detalhes || ""),
    precoBase,
    categoriaType: isPizza ? "pizza" : catTipo || "",
    categoriaNome: getProdutoCategoriaTexto(p) || "",
    saboresDisponiveis: arr(saboresDisponiveis).map((s) => ({
      nome: safeText(s?.nome ?? s?.label ?? s?.title ?? s) || "",
      preco: toNum(s?.preco ?? 0),
    })),
    maxSabores: toNum(p?.maxSabores || 0) || (isPizza ? 2 : 0),
    calculoPrecoPor: safeText(p?.calculoPrecoPor || "maior").toLowerCase(),
    bordasDisponiveis: arr(bordasDisponiveis).map((b) => ({
      nome: safeText(b?.nome ?? b?.label ?? b?.title ?? b) || "",
      preco: toNum(b?.preco ?? 0),
    })),
    adicionais: arr(adicionais).map((a) => ({
      nome: safeText(a?.nome ?? a?.label ?? a?.title ?? a) || "",
      preco: toNum(a?.preco ?? 0),
    })),
    complementos: arr(complementos).map((c) => ({
      nome: safeText(c?.nome ?? c?.label ?? c?.title ?? c) || "",
      preco: toNum(c?.preco ?? 0),
    })),
    tiposExtras: arr(tiposExtras).map((t) => ({
      nome: safeText(t?.nome) || "Extras",
      obrigatorio: !!t?.obrigatorio,
      tipoSelecion: safeText(t?.tipoSelecion || "multiplo"),
      minimoSelecionados: toNum(t?.minimoSelecionados || 0),
      maximoSelecionados:
        t?.maximoSelecionados === undefined || t?.maximoSelecionados === null
          ? undefined
          : toNum(t?.maximoSelecionados),
      itens: arr(t?.itens).map((i) => ({
        nome: safeText(i?.nome ?? i?.label ?? i?.title ?? i) || "",
        preco: toNum(i?.preco ?? 0),
      })),
    })),
  };
}

/* =========================
   UI Helpers (Radio / Checkbox)
========================= */
function OptionRow({ label, rightText, selected, type = "radio", disabled, onPress }) {
  const iconName =
    type === "checkbox"
      ? selected
        ? "checkbox"
        : "square-outline"
      : selected
      ? "radio-button-on"
      : "radio-button-off";

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.optRow,
        pressed && !disabled && { opacity: 0.9 },
        disabled && { opacity: 0.55 },
      ]}
    >
      <Ionicons name={iconName} size={18} color={selected ? "#ff3b8a" : "#64748b"} />
      <Text style={styles.optLabel} numberOfLines={2}>
        {label}
      </Text>
      {!!rightText && <Text style={styles.optRight}>{rightText}</Text>}
    </Pressable>
  );
}

/* =========================
   MODAL DETALHES ITEM (UX)
========================= */
function ModalItemDetails({ visible, onClose, item }) {
  const resumo = item ? buildResumoItem(item) : { full: "", personalizado: false };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { width: "100%", maxWidth: 520 }]}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                Detalhes do item
              </Text>
              <Text style={styles.modalSub} numberOfLines={2}>
                {safeText(item?.nome || "Item")}
              </Text>
            </View>

            <Pressable onPress={onClose} style={({ pressed }) => [styles.iconCircle, pressed && { opacity: 0.9 }]}>
              <Ionicons name="close" size={18} color="#0f172a" />
            </Pressable>
          </View>

          {!resumo.personalizado ? (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontWeight: "900", color: "#0f172a" }}>Esse item não tem personalizações.</Text>
              {!!safeText(item?.observacao) && (
                <Text style={{ marginTop: 8, color: "#64748b", fontWeight: "800" }}>
                  Obs: {safeText(item.observacao)}
                </Text>
              )}
            </View>
          ) : (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontWeight: "900", color: "#0f172a", marginBottom: 6 }}>Resumo</Text>
              <Text style={{ color: "#64748b", fontWeight: "800", lineHeight: 18 }}>
                {resumo.full}
              </Text>
            </View>
          )}

          <Pressable onPress={onClose} style={({ pressed }) => [styles.primaryBtnDark, pressed && { opacity: 0.92 }, { marginTop: 14 }]}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.primaryDarkText}>Entendi</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* =========================
   MODAL CONFIG PRODUTO
========================= */
function ModalConfigProdutoMobile({ visible, onClose, produto, onConfirm }) {
  const [saboresSelecionados, setSaboresSelecionados] = useState([]);
  const [bordaSelecionada, setBordaSelecionada] = useState("nenhum");
  const [adicionalSelecionado, setAdicionalSelecionado] = useState("nenhum");
  const [complementosSelecionados, setComplementosSelecionados] = useState([]);
  const [tiposExtrasSelecionados, setTiposExtrasSelecionados] = useState({});
  const [observacao, setObservacao] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [erro, setErro] = useState("");

  const isPizza =
    produto?.categoriaType === "pizza" ||
    (Array.isArray(produto?.saboresDisponiveis) &&
      produto.saboresDisponiveis.length > 0 &&
      Number(produto?.maxSabores || 0) > 0);

  useEffect(() => {
    if (!visible) return;

    setSaboresSelecionados([]);
    setBordaSelecionada("nenhum");
    setAdicionalSelecionado("nenhum");
    setComplementosSelecionados([]);
    setTiposExtrasSelecionados({});
    setObservacao("");
    setQuantidade(1);
    setErro("");

    if (!produto) return;

    if (Array.isArray(produto.saboresDisponiveis) && produto.saboresDisponiveis.length === 1) {
      setSaboresSelecionados([produto.saboresDisponiveis[0].nome]);
    }

    const auto = {};
    (Array.isArray(produto?.tiposExtras) ? produto.tiposExtras : []).forEach((tipo) => {
      const itens = Array.isArray(tipo?.itens) ? tipo.itens : [];
      if (tipo?.tipoSelecion === "unico" && itens.length === 1) auto[tipo.nome] = [itens[0]];
      if (tipo?.tipoSelecion === "multiplo" && tipo?.obrigatorio && Number(tipo?.minimoSelecionados || 0) > 0) {
        auto[tipo.nome] = itens.slice(0, Number(tipo.minimoSelecionados)) || [];
      }
    });
    setTiposExtrasSelecionados(auto);
  }, [visible, produto]);

  const precoTotal = useMemo(() => {
    if (!produto) return 0;

    let total = Number(produto?.precoBase || 0);

    if (isPizza && saboresSelecionados.length > 0) {
      const sabores = Array.isArray(produto?.saboresDisponiveis) ? produto.saboresDisponiveis : [];
      const precos = saboresSelecionados
        .map((nome) => {
          const s = sabores.find((x) => x?.nome === nome);
          return Number(s?.preco || 0);
        })
        .filter((n) => Number.isFinite(n));

      if (precos.length) {
        if (String(produto?.calculoPrecoPor || "").toLowerCase() === "media") {
          total = precos.reduce((a, b) => a + b, 0) / precos.length;
        } else {
          total = Math.max(...precos);
        }
      }
    }

    if (bordaSelecionada !== "nenhum") {
      const bordas = Array.isArray(produto?.bordasDisponiveis) ? produto.bordasDisponiveis : [];
      const b = bordas.find((x) => x?.nome === bordaSelecionada);
      total += Number(b?.preco || 0);
    }

    if (adicionalSelecionado !== "nenhum") {
      const adicionais = Array.isArray(produto?.adicionais) ? produto.adicionais : [];
      const a = adicionais.find((x) => x?.nome === adicionalSelecionado);
      total += Number(a?.preco || 0);
    }

    const comps = Array.isArray(produto?.complementos) ? produto.complementos : [];
    complementosSelecionados.forEach((nome) => {
      const c = comps.find((x) => x?.nome === nome);
      total += Number(c?.preco || 0);
    });

    Object.entries(tiposExtrasSelecionados || {}).forEach(([, itens]) => {
      (Array.isArray(itens) ? itens : []).forEach((i) => {
        total += Number(i?.preco || 0);
      });
    });

    total *= Math.max(1, Number(quantidade || 1));
    return Number.isFinite(total) ? Number(total.toFixed(2)) : 0;
  }, [
    produto,
    isPizza,
    saboresSelecionados,
    bordaSelecionada,
    adicionalSelecionado,
    complementosSelecionados,
    tiposExtrasSelecionados,
    quantidade,
  ]);

  const mostrarPrecoAPartir =
    !!produto &&
    isPizza &&
    Array.isArray(produto?.saboresDisponiveis) &&
    produto.saboresDisponiveis.length > 1;

  const precoAPartir = useMemo(() => {
    if (!produto) return 0;
    if (!mostrarPrecoAPartir) return Number(produto?.precoBase || 0);

    const sabores = Array.isArray(produto?.saboresDisponiveis) ? produto.saboresDisponiveis : [];
    const min = sabores.reduce((m, s) => Math.min(m, Number(s?.preco || Infinity)), Infinity);
    if (!Number.isFinite(min)) return Number(produto?.precoBase || 0);
    return min;
  }, [produto, mostrarPrecoAPartir]);

  const validate = () => {
    if (!produto) return "Produto inválido.";

    if (isPizza) {
      const max = Number(produto?.maxSabores || 2) || 2;
      const sabores = Array.isArray(produto?.saboresDisponiveis) ? produto.saboresDisponiveis : [];

      if (sabores.length > 1) {
        if (saboresSelecionados.length !== max) return `Selecione exatamente ${max} sabor(es).`;
      } else if (sabores.length === 1 && saboresSelecionados.length !== 1) {
        return "Selecione o sabor da pizza.";
      }
    }

    const tipos = Array.isArray(produto?.tiposExtras) ? produto.tiposExtras : [];
    for (const tipo of tipos) {
      const selecionados = Array.isArray(tiposExtrasSelecionados?.[tipo.nome])
        ? tiposExtrasSelecionados[tipo.nome]
        : [];

      if (tipo?.obrigatorio && selecionados.length === 0)
        return `Selecione pelo menos uma opção em "${tipo.nome}".`;

      const min = Number(tipo?.minimoSelecionados || 0);
      if (min && selecionados.length < min)
        return `Selecione pelo menos ${min} opção(ões) em "${tipo.nome}".`;

      const max = tipo?.maximoSelecionados;
      if (max !== undefined && max !== null && selecionados.length > Number(max))
        return `Você pode escolher no máximo ${Number(max)} opção(ões) em "${tipo.nome}".`;
    }

    return "";
  };

  const handleConfirm = () => {
    const msg = validate();
    if (msg) {
      setErro(msg);
      return;
    }

    const qtd = Math.max(1, Number(quantidade || 1));

    const item = {
      nome: String(produto?.nome || "Item"),
      produtoId: String(produto?._id || ""),
      imagem: String(produto?.imagem || ""),
      categoriaType: String(produto?.categoriaType || ""),
      saboresSelecionados,
      bordaSelecionada:
        bordaSelecionada === "nenhum"
          ? null
          : (Array.isArray(produto?.bordasDisponiveis) ? produto.bordasDisponiveis : []).find(
              (b) => b?.nome === bordaSelecionada
            ),
      adicionalSelecionado:
        adicionalSelecionado === "nenhum"
          ? null
          : (Array.isArray(produto?.adicionais) ? produto.adicionais : []).find((a) => a?.nome === adicionalSelecionado),
      complementosSelecionados: (Array.isArray(produto?.complementos) ? produto.complementos : []).filter((c) =>
        complementosSelecionados.includes(c?.nome)
      ),
      tiposExtrasSelecionados,
      observacao: String(observacao || ""),
      quantidade: qtd,
      precoUnitario: Number(produto?.precoBase || 0),
      precoTotal,
    };

    onConfirm?.(item);
  };

  const ready = !!produto;

  const maxSabores = Number(produto?.maxSabores || 2) || 2;
  const sabores = Array.isArray(produto?.saboresDisponiveis) ? produto.saboresDisponiveis : [];
  const pizzaMulti = ready && isPizza && sabores.length > 1 && maxSabores > 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
          <View style={[styles.modalCard, { maxHeight: "85%", width: "100%", maxWidth: 520 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {ready ? String(produto?.nome || "Item") : "Carregando..."}
                </Text>
                <Text style={styles.modalSub} numberOfLines={1}>
                  {ready
                    ? mostrarPrecoAPartir
                      ? `a partir de ${money(precoAPartir)}`
                      : money(Number(produto?.precoBase || 0))
                    : " "}
                </Text>
              </View>

              <Pressable onPress={onClose} style={({ pressed }) => [styles.iconCircle, pressed && { opacity: 0.9 }]}>
                <Ionicons name="close" size={18} color="#0f172a" />
              </Pressable>
            </View>

            {!ready ? (
              <View style={{ paddingVertical: 18, alignItems: "center" }}>
                <ActivityIndicator />
                <Text style={{ marginTop: 10, fontWeight: "900", color: "#64748b" }}>
                  Preparando configurações...
                </Text>
              </View>
            ) : (
              <>
                {erro ? (
                  <View style={styles.warnBox}>
                    <Ionicons name="alert-circle-outline" size={16} color="#b45309" />
                    <Text style={styles.warnText}>{erro}</Text>
                  </View>
                ) : null}

                <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 10 }}>
                  {/* SABORES */}
                  {isPizza && sabores.length > 0 && (
                    <View style={styles.block}>
                      <Text style={styles.blockTitle}>
                        Sabores {pizzaMulti ? `(escolha exatamente ${maxSabores})` : ""}
                      </Text>

                      {sabores.length === 1 || maxSabores === 1 ? (
                        sabores.map((s, i) => {
                          const sel = saboresSelecionados[0] === s.nome;
                          return (
                            <OptionRow
                              key={`${s.nome}-${i}`}
                              type="radio"
                              selected={sel}
                              label={s.preco ? `${s.nome} (+${money(toNum(s.preco))})` : s.nome}
                              onPress={() => setSaboresSelecionados([s.nome])}
                            />
                          );
                        })
                      ) : (
                        sabores.map((s, i) => {
                          const checked = saboresSelecionados.includes(s.nome);
                          const disabled = !checked && saboresSelecionados.length >= maxSabores && maxSabores > 0;

                          return (
                            <OptionRow
                              key={`${s.nome}-${i}`}
                              type="checkbox"
                              selected={checked}
                              disabled={disabled}
                              label={s.preco ? `${s.nome} (+${money(toNum(s.preco))})` : s.nome}
                              onPress={() => {
                                if (checked) setSaboresSelecionados((prev) => prev.filter((x) => x !== s.nome));
                                else if (saboresSelecionados.length < maxSabores)
                                  setSaboresSelecionados((prev) => [...prev, s.nome]);
                              }}
                            />
                          );
                        })
                      )}
                    </View>
                  )}

                  {/* BORDA */}
                  {Array.isArray(produto?.bordasDisponiveis) && produto.bordasDisponiveis.length > 0 && (
                    <View style={styles.block}>
                      <Text style={styles.blockTitle}>Borda</Text>
                      <OptionRow
                        type="radio"
                        selected={bordaSelecionada === "nenhum"}
                        label="Sem borda"
                        onPress={() => setBordaSelecionada("nenhum")}
                      />
                      {produto.bordasDisponiveis.map((b, i) => (
                        <OptionRow
                          key={`${b.nome}-${i}`}
                          type="radio"
                          selected={bordaSelecionada === b.nome}
                          label={`${b.nome} (+${money(toNum(b.preco))})`}
                          onPress={() => setBordaSelecionada(b.nome)}
                        />
                      ))}
                    </View>
                  )}

                  {/* ADICIONAIS */}
                  {Array.isArray(produto?.adicionais) && produto.adicionais.length > 0 && (
                    <View style={styles.block}>
                      <Text style={styles.blockTitle}>Adicional</Text>
                      <OptionRow
                        type="radio"
                        selected={adicionalSelecionado === "nenhum"}
                        label="Sem adicional"
                        onPress={() => setAdicionalSelecionado("nenhum")}
                      />
                      {produto.adicionais.map((a, i) => (
                        <OptionRow
                          key={`${a.nome}-${i}`}
                          type="radio"
                          selected={adicionalSelecionado === a.nome}
                          label={`${a.nome} (+${money(toNum(a.preco))})`}
                          onPress={() => setAdicionalSelecionado(a.nome)}
                        />
                      ))}
                    </View>
                  )}

                  {/* TIPOS EXTRAS */}
                  {(Array.isArray(produto?.tiposExtras) ? produto.tiposExtras : []).map((tipo, idx) => {
                    const itensTipo = Array.isArray(tipo?.itens) ? tipo.itens.filter((x) => safeText(x?.nome)) : [];
                    if (!itensTipo.length) return null;

                    const selecionados = Array.isArray(tiposExtrasSelecionados?.[tipo.nome])
                      ? tiposExtrasSelecionados[tipo.nome]
                      : [];
                    const isUnico = String(tipo?.tipoSelecion) === "unico";
                    const max = tipo?.maximoSelecionados;

                    return (
                      <View key={`${tipo.nome}-${idx}`} style={styles.block}>
                        <Text style={styles.blockTitle}>
                          {safeText(tipo.nome)} {tipo?.obrigatorio ? "*" : ""}{" "}
                          {!isUnico && max !== undefined && max !== null ? `(até ${Number(max)})` : ""}
                        </Text>

                        {isUnico ? (
                          <>
                            {!tipo?.obrigatorio && (
                              <OptionRow
                                type="radio"
                                selected={selecionados.length === 0}
                                label="Nenhum"
                                onPress={() =>
                                  setTiposExtrasSelecionados((prev) => ({
                                    ...prev,
                                    [tipo.nome]: [],
                                  }))
                                }
                              />
                            )}
                            {itensTipo.map((it, i) => {
                              const sel = selecionados?.[0]?.nome === it.nome;
                              return (
                                <OptionRow
                                  key={`${it.nome}-${i}`}
                                  type="radio"
                                  selected={sel}
                                  label={`${it.nome} (+${money(toNum(it.preco))})`}
                                  onPress={() =>
                                    setTiposExtrasSelecionados((prev) => ({
                                      ...prev,
                                      [tipo.nome]: [it],
                                    }))
                                  }
                                />
                              );
                            })}
                          </>
                        ) : (
                          <>
                            {itensTipo.map((it, i) => {
                              const checked = selecionados.some((s) => s?.nome === it.nome);
                              const disabled =
                                !checked && max !== undefined && max !== null && selecionados.length >= Number(max);

                              return (
                                <OptionRow
                                  key={`${it.nome}-${i}`}
                                  type="checkbox"
                                  selected={checked}
                                  disabled={disabled}
                                  label={`${it.nome} (+${money(toNum(it.preco))})`}
                                  onPress={() => {
                                    const next = checked
                                      ? selecionados.filter((s) => s?.nome !== it.nome)
                                      : [...selecionados, it];
                                    setTiposExtrasSelecionados((prev) => ({
                                      ...prev,
                                      [tipo.nome]: next,
                                    }));
                                  }}
                                />
                              );
                            })}
                          </>
                        )}
                      </View>
                    );
                  })}

                  {/* COMPLEMENTOS */}
                  {Array.isArray(produto?.complementos) && produto.complementos.length > 0 && (
                    <View style={styles.block}>
                      <Text style={styles.blockTitle}>Complementos</Text>
                      {produto.complementos.map((c, i) => {
                        const checked = complementosSelecionados.includes(c.nome);
                        return (
                          <OptionRow
                            key={`${c.nome}-${i}`}
                            type="checkbox"
                            selected={checked}
                            label={`${c.nome} (+${money(toNum(c.preco))})`}
                            onPress={() => {
                              setComplementosSelecionados((prev) =>
                                checked ? prev.filter((x) => x !== c.nome) : [...prev, c.nome]
                              );
                            }}
                          />
                        );
                      })}
                    </View>
                  )}

                  {/* OBS */}
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>Observações</Text>
                    <TextInput
                      value={observacao}
                      onChangeText={setObservacao}
                      placeholder="Ex: tirar cebola, bem passado..."
                      placeholderTextColor="#94a3b8"
                      style={[styles.input, { minHeight: 46 }]}
                      multiline
                    />
                  </View>

                  {/* QTD */}
                  <View style={styles.block}>
                    <Text style={styles.blockTitle}>Quantidade</Text>
                    <View style={styles.stepper}>
                      <Pressable
                        onPress={() => setQuantidade((q) => Math.max(1, Number(q || 1) - 1))}
                        style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.85 }]}
                      >
                        <Ionicons name="remove" size={18} color="#0f172a" />
                      </Pressable>
                      <Text style={styles.stepValue}>{quantidade}</Text>
                      <Pressable
                        onPress={() => setQuantidade((q) => Math.min(99, Number(q || 1) + 1))}
                        style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.85 }]}
                      >
                        <Ionicons name="add" size={18} color="#0f172a" />
                      </Pressable>
                    </View>
                  </View>

                  <View style={{ height: 12 }} />
                </ScrollView>

                <View style={styles.configFooter}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.configFooterLabel}>Total</Text>
                    <Text style={styles.configFooterTotal}>{money(precoTotal)}</Text>
                  </View>

                  <Pressable
                    onPress={handleConfirm}
                    style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.92 }]}
                  >
                    <Text style={styles.primaryText}>Adicionar na comanda</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export default function ComandaScreen({ navigation, route }) {
  const mesaId = route?.params?.mesaId;
  const mesaNumero = route?.params?.mesaNumero;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [mesa, setMesa] = useState(null);
  const [pedido, setPedido] = useState(null);

  // modal adicionar
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("catalogo"); // catalogo | manual

  // catálogo
  const [catLoading, setCatLoading] = useState(false);
  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState("");
  const [restauranteId, setRestauranteId] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [catalogoFromCache, setCatalogoFromCache] = useState(false);
  const [comandaFromCache, setComandaFromCache] = useState(false);

  // seleção/config
  const [selected, setSelected] = useState(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // manual
  const [nomeItem, setNomeItem] = useState("");
  const [qtdItem, setQtdItem] = useState("1");
  const [precoItem, setPrecoItem] = useState("");

  // ✅ real-time tick
  const [tick, setTick] = useState(0);

  // ✅ pendências
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingLocalItems, setPendingLocalItems] = useState([]);

  // ✅ permissão do garçom
  const [canFecharConta, setCanFecharConta] = useState(false);
  const [restaurantePlano, setRestaurantePlano] = useState("");

  // ✅ MercadoPago conectado?
  const [mpConectado, setMpConectado] = useState(false);
  const [mpChecking, setMpChecking] = useState(false);

  // ✅ modal fechar conta e pix
  const [fecharOpen, setFecharOpen] = useState(false);
  const [pixOpen, setPixOpen] = useState(false);
  const [pixLoading, setPixLoading] = useState(false);

  // ✅ dados do PIX
  const [pixInfo, setPixInfo] = useState(null); // { paymentId, status, qrCode, qrCodeBase64 }
  const [pixStatus, setPixStatus] = useState("");
  const [pixErr, setPixErr] = useState("");

  // ✅ UX aguardando pagamento
  const [pixAutoChecking, setPixAutoChecking] = useState(false);
  const [pixCountdown, setPixCountdown] = useState(0);
  const [pixPaidBanner, setPixPaidBanner] = useState(false);
  const navigatingRef = useRef(false);

  // ✅ detalhes item (UX)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState(null);

  // anim/som
  const lastUpdateRef = useRef(0);
  const pulseHeader = useRef(new Animated.Value(0)).current;
  const soundItemRef = useRef(null);
  const lastItensCountRef = useRef(0);

  // animação no modal Pix (pulso)
  const pixPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(require("../../assets/sounds/item_in.mp3"), {
          shouldPlay: false,
          volume: 0.9,
        });

        if (!mounted) {
          sound.unloadAsync();
          return;
        }

        soundItemRef.current = sound;

        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
        });
      } catch (e) {
        console.warn("Som (item) não carregado:", e?.message);
      }
    })();

    return () => {
      mounted = false;
      soundItemRef.current?.unloadAsync?.();
    };
  }, []);

  // ✅ pulso no “aguardando pagamento”
  useEffect(() => {
    if (!pixOpen) return;
    pixPulse.setValue(0);

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pixPulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pixPulse, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pixOpen, pixPulse]);

  const playItem = async () => {
    try {
      const s = soundItemRef.current;
      if (!s) return;
      await s.setPositionAsync(0);
      await s.playAsync();
    } catch {}
  };

  const markUpdated = () => {
    lastUpdateRef.current = Date.now();

    pulseHeader.setValue(0);
    Animated.sequence([
      Animated.timing(pulseHeader, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.timing(pulseHeader, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  };

  const isUpdatedNow = (ms = 7000) => {
    const ts = lastUpdateRef.current;
    return !!ts && Date.now() - ts <= ms;
  };

  const refreshPending = async () => {
    try {
      if (!mesaId) return setPendingCount(0);
      const c = await getQueueCountByMesa(mesaId);
      setPendingCount(Number(c || 0));
    } catch {
      setPendingCount(0);
    }
  };

  const optimisticAddPendingItems = (itensToAdd) => {
    const now = Date.now();
    const pendentes = (Array.isArray(itensToAdd) ? itensToAdd : []).map((it, idx) => ({
      ...it,
      _tempId: `pending_${now}_${idx}`,
      _pending: true,
      _createdAt: new Date().toISOString(),
    }));

    setPendingLocalItems((prev) => [...pendentes, ...prev]);
  };

  const fetchComanda = async () => {
    if (!mesaId) return;
    try {
      const result = await cachedApiGet({
        key: COMANDA_CACHE_KEY(mesaId),
        request: () => api.get(COMANDA_ENDPOINT(mesaId)),
        fallback: {},
        onCache: ({ data }) => {
          setMesa(data?.mesa || null);
          setPedido(data?.pedido || null);
          setComandaFromCache(true);
        },
      });
      setMesa(result?.data?.mesa || null);
      setPedido(result?.data?.pedido || null);
      setComandaFromCache(!!result?.fromCache);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.mensagem || "Erro ao buscar comanda.";
      Alert.alert("Erro", msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const normalizeCatalogoResponse = (data) => {
    const list =
      Array.isArray(data)
        ? data
        : Array.isArray(data?.produtos)
        ? data.produtos
        : Array.isArray(data?.itens)
        ? data.itens
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.items)
        ? data.items
        : [];

    return list
      .filter((p) => p?.ativo !== false && p?.disponivel !== false)
      .map((p) => normalizeProdutoParaConfig(p))
      .filter(Boolean);
  };

  const applyCatalogoData = (data, fromCache = false) => {
    const normalizados = normalizeCatalogoResponse(data);
    setProdutos(normalizados);
    setCatalogoFromCache(!!fromCache);
    return normalizados;
  };

  const fetchCatalogo = async ({ silent = false } = {}) => {
    const session = await getSession();
    const rid = restauranteId || pickRestauranteIdFromSession(session);
    const slug = pickRestauranteSlugFromSession(session);

    if (!rid && !slug) {
      if (!silent) Alert.alert("Catálogo", "Restaurante não identificado para carregar o cardápio.");
      return [];
    }

    const primaryKey = CATALOGO_CACHE_KEY(rid || slug);
    const aliasKeys = [
      rid ? CATALOGO_CACHE_KEY(rid) : null,
      slug ? CATALOGO_CACHE_SLUG_KEY(slug) : null,
    ].filter(Boolean);

    setCatLoading(!silent);
    try {
      // ✅ Carrega cache imediatamente antes da rede. Assim, se o garçom abrir
      // a comanda sem internet, os itens continuam disponíveis para lançar.
      const result = await cachedApiGet({
        key: primaryKey,
        request: () => api.get(buildProdutosEndpoint(rid || slug)),
        fallback: [],
        onCache: ({ data }) => applyCatalogoData(data, true),
      });

      const normalizados = applyCatalogoData(result?.data, !!result?.fromCache);

      // ✅ Mantém aliases do cache por ID e slug. Isso evita perder o cardápio
      // quando a API/logon retorna id em um momento e slug em outro.
      for (const key of aliasKeys) {
        await cacheSet(key, result?.data || []);
      }

      return normalizados;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.mensagem || "Erro ao carregar catálogo.";
      if (!silent) Alert.alert("Catálogo", msg);
      setProdutos([]);
      return [];
    } finally {
      setCatLoading(false);
    }
  };

  const fetchMpStatusFromApi = async (rid) => {
    if (!rid) return false;

    setMpChecking(true);
    try {
      // ✅ Usa a rota oficial do Mercado Pago primeiro. A rota de restaurante
      // pode esconder campos sensíveis e fazer o app achar que está desconectado.
      let data = null;
      try {
        const statusRes = await api.get(`/api/mercadopago/status/${rid}`);
        data = statusRes?.data || null;
      } catch (_) {}

      if (!data) {
        const res = await api.get(RESTAURANTE_GET_ENDPOINT(rid));
        data = res?.data?.restaurante || res?.data || {};
      }

      const mp = pickMpFromRestaurante(data);
      const conectado = mp.conectado || mp.hasAccessToken;

      setMpConectado(!!conectado);

      await updateSessionRestaurantePatch({
        mercadoPago: { conectado: !!conectado },
      });

      return !!conectado;
    } catch (e) {
      return mpConectado;
    } finally {
      setMpChecking(false);
    }
  };

  // ✅ pega restauranteId + permissão fecharConta do garçom + status mp
  useEffect(() => {
    (async () => {
      const s = await getSession();
      const rid = pickRestauranteIdFromSession(s);
      setRestauranteId(rid);

      let planoSessao = normalizePlano(s?.restaurante?.plano || s?.restaurante?.plan || "");
      setRestaurantePlano(planoSessao);

      // ✅ Compatibilidade: versões antigas do login do garçom não retornavam o plano.
      // Busca na API e atualiza a sessão para liberar recursos do plano no Hub-Garçom.
      if (!planoSessao && rid) {
        try {
          const restRes = await api.get(RESTAURANTE_GET_ENDPOINT(rid));
          const restData = restRes?.data?.restaurante || restRes?.data || {};
          planoSessao = normalizePlano(restData?.plano || restData?.plan || "");
          if (planoSessao) {
            setRestaurantePlano(planoSessao);
            await updateSessionRestaurantePatch({ plano: planoSessao });
          }
        } catch (_) {}
      }

      const perm =
        s?.garcom?.permissoes?.fecharConta ??
        s?.usuario?.permissoes?.fecharConta ??
        s?.permissoes?.fecharConta ??
        false;

      setCanFecharConta(!!perm);

      const conectadoSessao = boolLike(s?.restaurante?.mercadoPago?.conectado);
      setMpConectado(conectadoSessao);

      if (!conectadoSessao && rid) {
        await fetchMpStatusFromApi(rid);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restauranteId) return;
    fetchCatalogo({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restauranteId]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const online = !!state?.isConnected && state?.isInternetReachable !== false;
      setIsOnline(online);
      if (online) {
        flushQueue({ api }).then((r) => {
          if (r?.sent > 0) {
            setPendingLocalItems([]);
            fetchComanda();
          }
          refreshPending();
        });
        if (restauranteId) fetchCatalogo();
      }
    });
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restauranteId, mesaId]);

  useEffect(() => {
    fetchComanda();
    refreshPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesaId]);

  useEffect(() => {
    if (!mesaId) return;

    const unsub = startQueueWatcher({
      api,
      onFlush: async ({ sent }) => {
        if (sent > 0) {
          setPendingLocalItems([]);
          await fetchComanda();
        }
        await refreshPending();
      },
      onChange: () => {
        refreshPending();
      },
    });

    (async () => {
      const r = await flushQueue({ api });
      if (r?.sent > 0) {
        setPendingLocalItems([]);
        await fetchComanda();
      }
      await refreshPending();
    })();

    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesaId]);

  // =========================
  // ✅ Helpers: detectar pago e finalizar UX
  // =========================
  const isPaidStatus = (st) => {
    const s = String(st || "").toLowerCase();
    return s === "approved" || s === "paid" || s === "aprovado" || s === "confirmado";
  };

  const mesaEstaLivre = (m) => {
    const st = String(m?.status || "").toLowerCase();
    return st === "livre";
  };

  const finalizarPagamentoERedirecionar = async () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    setPixPaidBanner(true);

    setTimeout(() => {
      setPixOpen(false);
      setPixAutoChecking(false);
      setPixCountdown(0);
      setPixInfo(null);
      setPixStatus("");
      setPixErr("");

      try {
        navigation.navigate("Mesas");
      } catch {
        navigation.goBack();
      }

      setTimeout(() => {
        navigatingRef.current = false;
        setPixPaidBanner(false);
      }, 800);
    }, 650);
  };

  // =========================
  // ✅ SOCKET: atualiza e se detectar livre/pago, fecha Pix e navega
  // =========================
  useEffect(() => {
    let socket;

    const onPedidoAtualizado = (payload) => {
      const pedidoAtualizado = payload?.pedido || payload;

      if (pedidoAtualizado?._id && pedidoAtualizado._id === pedido?._id) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPedido(pedidoAtualizado);
        markUpdated();

        // ✅ som apenas se entrou item novo (melhor UX)
        const newCount = Array.isArray(pedidoAtualizado?.itens) ? pedidoAtualizado.itens.length : 0;
        const oldCount = Number(lastItensCountRef.current || 0);
        if (newCount > oldCount) {
          playItem();
        }
        lastItensCountRef.current = newCount;
      }
    };

    const onMesaAtualizada = (mesaAtualizada) => {
      if (mesaAtualizada?._id && String(mesaAtualizada._id) === String(mesaId)) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setMesa(mesaAtualizada);
        markUpdated();

        if (pixOpen && mesaEstaLivre(mesaAtualizada)) {
          finalizarPagamentoERedirecionar();
        }
      }
    };

    (async () => {
      const session = await getSession();
      const rid = session?.restaurante?._id;
      if (!rid) return;

      socket = connectSocket(rid);
      socket.on("pedidoAtualizado", onPedidoAtualizado);
      socket.on("mesaAtualizada", onMesaAtualizada);
    })();

    return () => {
      const s = getSocket();
      s?.off("pedidoAtualizado", onPedidoAtualizado);
      s?.off("mesaAtualizada", onMesaAtualizada);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesaId, pedido?._id, pixOpen]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchComanda();
    await fetchCatalogo({ silent: true });
    await refreshPending();
  };

  const total = useMemo(() => {
    const vt = Number(pedido?.valorTotal ?? pedido?.total);
    if (Number.isFinite(vt) && vt >= 0) return vt;

    const arrItens = arr(pedido?.itens);
    return arrItens.reduce((acc, it) => {
      const t = Number.isFinite(Number(it.precoTotal))
        ? Number(it.precoTotal)
        : toNum(it.precoUnitario) * toNum(it.quantidade);
      return acc + t;
    }, 0);
  }, [pedido]);

  const itens = useMemo(() => {
    const server = [...arr(pedido?.itens)].reverse();
    return [...pendingLocalItems, ...server];
  }, [pedido, pendingLocalItems]);

  // ✅ atualiza referência do count pra som
  useEffect(() => {
    const c = Array.isArray(pedido?.itens) ? pedido.itens.length : 0;
    lastItensCountRef.current = c;
  }, [pedido?._id]);

  const tempoOcupada = useMemo(() => {
    const _ = tick;
    if (!mesa?.ocupadaDesde) return null;
    return fmtMin(mesa.ocupadaDesde);
  }, [mesa?.ocupadaDesde, tick]);

  const abrirModal = async () => {
    setTab("catalogo");
    setBusca("");
    setSelected(null);
    setConfigOpen(false);

    setModalOpen(true);
    if (produtos.length === 0) await fetchCatalogo();
  };

  const abrirConfigProduto = (p) => {
    setSelected(p);
    setModalOpen(false);
    requestAnimationFrame(() => setConfigOpen(true));
  };

  const produtosFiltrados = useMemo(() => {
    const q = normalizeStr(busca);
    if (!q) return produtos;
    return produtos.filter((p) => normalizeStr(p?.nome).includes(q));
  }, [busca, produtos]);

  const addItensMesa = async (itensToAdd) => {
    setSaving(true);
    const itensPersistentes = (Array.isArray(itensToAdd) ? itensToAdd : []).map((it, idx) => ({
      ...it,
      _pending: true,
      _tempId: it?._tempId || `pending_cache_${Date.now()}_${idx}`,
    }));
    const payload = { itens: itensToAdd };

    try {
      await api.post(ADD_ITENS_ENDPOINT(mesaId), payload);

      markUpdated();
      playItem();

      setSelected(null);
      setConfigOpen(false);
      setModalOpen(false);

      await fetchComanda();
      await refreshPending();
    } catch (err) {
      const isNetwork =
        !err?.response ||
        err?.message?.toLowerCase?.().includes("network") ||
        err?.code === "ECONNABORTED";

      if (isNetwork) {
        optimisticAddPendingItems(itensToAdd);

        await enqueueAddItem({ mesaId, payload });
        await cacheSet(COMANDA_CACHE_KEY(mesaId), {
          mesa,
          pedido: {
            ...(pedido || {}),
            itens: [...(Array.isArray(pedido?.itens) ? pedido.itens : []), ...itensPersistentes],
          },
        });
        await refreshPending();

        markUpdated();
        setSelected(null);
        setConfigOpen(false);
        setModalOpen(false);

        Alert.alert(
          "Sem conexão",
          "Item lançado e marcado como pendente. Será enviado quando a internet voltar."
        );
        return;
      }

      const msg =
        err?.response?.data?.message || err?.response?.data?.mensagem || "Erro ao adicionar item.";
      Alert.alert("Erro", msg);
    } finally {
      setSaving(false);
    }
  };

  const adicionarManual = async () => {
    Keyboard.dismiss();

    const nome = String(nomeItem || "").trim();
    const qtd = Math.max(1, parseInt(String(qtdItem || "1").replace(/\D/g, ""), 10) || 1);
    const unit = toNum(precoItem);

    if (!nome) return Alert.alert("Ops", "Digite o nome do item.");
    if (!unit || unit <= 0) return Alert.alert("Ops", "Digite um preço válido.");

    const precoTotal = Number((qtd * unit).toFixed(2));

    await addItensMesa([
      {
        nome,
        quantidade: qtd,
        precoUnitario: unit,
        precoTotal,
        produtoId: "",
        imagem: "",
        categoriaType: "",
        saboresSelecionados: [],
        bordaSelecionada: null,
        adicionalSelecionado: null,
        complementosSelecionados: [],
        tiposExtrasSelecionados: {},
        observacao: "",
      },
    ]);

    setNomeItem("");
    setQtdItem("1");
    setPrecoItem("");
  };

  const TabBtn = ({ value, label, icon }) => {
    const active = tab === value;
    return (
      <Pressable
        onPress={() => setTab(value)}
        style={({ pressed }) => [styles.tabBtn, active && styles.tabBtnActive, pressed && { opacity: 0.9 }]}
      >
        <Ionicons name={icon} size={16} color={active ? "#0f172a" : "#64748b"} />
        <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const garantirCaixaAberto = async () => {
    const rid = restauranteId || pickRestauranteIdFromSession(await getSession());
    if (!rid) return true;
    try {
      const res = await api.get(CAIXA_ATUAL_ENDPOINT(rid));
      const data = res?.data || {};
      const caixa = data?.caixa || data?.sessao || data;
      const aberto = data?.aberto === true || String(caixa?.status || "").toLowerCase() === "aberto" || !!caixa?.aberto;
      if (aberto) return true;
      Alert.alert("Caixa fechado", "Abra o caixa no Hub-Restaurante antes de fechar mesa, abrir mesa ou vender no balcão.");
      return false;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        Alert.alert("Caixa fechado", "Abra o caixa no Hub-Restaurante antes de continuar.");
        return false;
      }
      Alert.alert("Caixa", err?.response?.data?.message || err?.response?.data?.mensagem || "Não consegui confirmar se o caixa está aberto.");
      return false;
    }
  };

  const fecharEmDinheiro = async () => {
    if (!mesaId) return;
    if (!(await garantirCaixaAberto())) return;
    setPixLoading(true);
    try {
      await api.post(FECHAR_MESA_ENDPOINT(mesaId), {
        metodoPagamento: "dinheiro",
        formaPagamento: "dinheiro",
        pagamento: "dinheiro",
        valor: total,
        valorRecebido: total,
        total,
      });
      setFecharOpen(false);
      Alert.alert("Mesa fechada", "Pagamento em dinheiro registrado no caixa e no resumo do turno.");
      await finalizarPagamentoERedirecionar();
    } catch (err) {
      Alert.alert("Erro", err?.response?.data?.message || err?.response?.data?.mensagem || err?.message || "Não foi possível fechar em dinheiro.");
    } finally {
      setPixLoading(false);
    }
  };

  const podeFecharDinheiro = canFecharConta && planoPermiteDinheiroMesa(restaurantePlano);

  // =========================
  // ✅ PIX FLOW (AGORA POR MESA)
  // =========================
  const abrirPix = async () => {
    if (!mesaId) return;
    if (!(await garantirCaixaAberto())) return;

    // ✅ Não bloqueia só pelo cache da sessão: o balcão pode estar conectado
    // enquanto a sessão antiga ainda diz desconectado. Confirmamos com a API.
    if (!mpConectado && restauranteId) {
      const ok = await fetchMpStatusFromApi(restauranteId);
      if (!ok) {
        // Ainda assim tentamos gerar: a API é a fonte da verdade e retorna erro real se faltar token.
        setMpConectado(true);
      }
    }

    setPixErr("");
    setPixStatus("");
    setPixInfo(null);
    setPixPaidBanner(false);

    setPixLoading(true);
    try {
      const res = await api.post(PIX_CREATE_ENDPOINT(mesaId), {});
      const data = res?.data || {};

      const qrCode = data?.qrCode || data?.pix_qr_code || "";
      const qrCodeBase64 = data?.qrCodeBase64 || data?.pix_qr_code_base64 || "";
      const paymentId = data?.paymentId || data?.mpPaymentId || data?.id || null;
      const status = data?.status || data?.statusPagamento || "pending";

      if (!qrCode && !qrCodeBase64) {
        throw new Error("PIX não retornou QR Code.");
      }

      setPixInfo({ paymentId, status, qrCode, qrCodeBase64 });
      setPixStatus(String(status || "pending"));

      setFecharOpen(false);
      setPixOpen(true);

      setPixAutoChecking(true);
      setPixCountdown(3);
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.mensagem ||
        err?.message ||
        "Erro ao gerar PIX.";
      setPixErr(msg);
      Alert.alert("Pix", msg);
    } finally {
      setPixLoading(false);
    }
  };

  const consultarPixStatus = async (opts = { silent: false }) => {
    if (!mesaId) return;

    if (!opts?.silent) setPixLoading(true);

    try {
      const res = await api.get(PIX_STATUS_ENDPOINT(mesaId));
      const data = res?.data || {};
      const st = data?.status || data?.statusPagamento || data?.mpStatus || "";

      if (st) setPixStatus(String(st));

      if (data?.pix_qr_code || data?.qrCode) {
        setPixInfo((prev) => ({
          ...(prev || {}),
          qrCode: data?.qrCode || data?.pix_qr_code || prev?.qrCode || "",
          qrCodeBase64: data?.qrCodeBase64 || data?.pix_qr_code_base64 || prev?.qrCodeBase64 || "",
          status: st || prev?.status,
        }));
      }

      if (isPaidStatus(st)) {
        await fetchComanda();
        await finalizarPagamentoERedirecionar();
        return;
      }

      if (mesaEstaLivre(mesa)) {
        await finalizarPagamentoERedirecionar();
      }
    } catch (err) {
      const statusCode = err?.response?.status;

      if (statusCode === 404) {
        await fetchComanda();
        if (mesaEstaLivre(mesa)) {
          await finalizarPagamentoERedirecionar();
        } else if (!opts?.silent) {
          Alert.alert("Pix", "Ainda aguardando confirmação do pagamento...");
        }
      } else if (!opts?.silent) {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.mensagem ||
          "Não foi possível consultar o status.";
        Alert.alert("Pix", msg);
      }
    } finally {
      if (!opts?.silent) setPixLoading(false);
    }
  };

  // ✅ Auto-check enquanto o modal do Pix estiver aberto
  useEffect(() => {
    if (!pixOpen || !pixAutoChecking) return;

    let alive = true;
    let countdownTimer = null;
    let pollTimer = null;

    countdownTimer = setInterval(() => {
      setPixCountdown((c) => Math.max(0, Number(c || 0) - 1));
    }, 1000);

    pollTimer = setInterval(async () => {
      if (!alive) return;
      setPixCountdown(3);
      await consultarPixStatus({ silent: true });
    }, 3000);

    return () => {
      alive = false;
      if (countdownTimer) clearInterval(countdownTimer);
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixOpen, pixAutoChecking]);

  const copiarCopiaECola = async () => {
    const code = String(pixInfo?.qrCode || "").trim();
    if (!code) return Alert.alert("Pix", "Código copia e cola não disponível.");
    await Clipboard.setStringAsync(code);
    Alert.alert("Copiado", "Código Pix copiado!");
  };

  const headerScale = pulseHeader.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });
  const showUpdated = isUpdatedNow();

  const totalEsperandoScale = pixPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  // ✅ render item (FlatList)
  const onOpenDetails = useCallback((item) => {
    const resumo = buildResumoItem(item);
    if (!resumo.personalizado && !safeText(item?.observacao)) return;
    setDetailsItem(item);
    setDetailsOpen(true);
  }, []);

  const renderItem = useCallback(
    ({ item, index }) => {
      const it = item;
      const qtd = Math.max(1, Number(it?.quantidade || 1));
      const unit = toNum(it?.precoUnitario);
      const tot = toNum(it?.precoTotal);
      const resumo = buildResumoItem(it);

      return (
        <Pressable
          onPress={() => onOpenDetails(it)}
          style={({ pressed }) => [
            styles.itemRow,
            pressed && { opacity: 0.96 },
            it?._pending && styles.itemRowPending,
          ]}
        >
          <View style={styles.itemIcon}>
            <Ionicons name="fast-food-outline" size={18} color="#ff3b8a" />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.itemName}>
                {safeText(it?.nome || it?.titulo || "Item")}
              </Text>

              {it?._pending && (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>PENDENTE</Text>
                </View>
              )}

              {resumo.personalizado && (
                <View style={styles.customBadge}>
                  <Text style={styles.customBadgeText}>PERSONALIZADO</Text>
                </View>
              )}
            </View>

            <Text style={styles.itemSub} numberOfLines={1}>
              {qtd}x {money(unit)} • Total: {money(tot)}
            </Text>

            {resumo.personalizado ? (
              <Text style={styles.itemResumo} numberOfLines={1}>
                {resumo.short}
              </Text>
            ) : safeText(it?.observacao) ? (
              <Text style={styles.itemResumo} numberOfLines={1}>
                Obs: {safeText(it.observacao)}
              </Text>
            ) : null}
          </View>

          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.itemTotal}>{money(tot)}</Text>
            {(resumo.personalizado || safeText(it?.observacao)) && (
              <Text style={styles.tapHint} numberOfLines={1}>
                ver
              </Text>
            )}
          </View>
        </Pressable>
      );
    },
    [onOpenDetails]
  );

  const keyExtractor = useCallback((it, idx) => {
    return it?._pending ? it?._tempId : (it?._id || `${idx}`);
  }, []);

  return (
    <View style={styles.root}>
      {/* HEADER */}
      <LinearGradient colors={["#ff3b8a", "#ff9b2d"]} style={styles.header}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="chevron-back" size={18} color="#fff" />
          </Pressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.hTitle} numberOfLines={1}>
              Comanda • {mesaNumero ?? mesa?.numero ?? "-"}
            </Text>

            <Text style={styles.hSub} numberOfLines={1}>
              {pedido?._id ? `Pedido ${String(pedido._id).slice(-6)}` : "Sem pedido"}
              {mesa?.status === "ocupada" && tempoOcupada ? ` • há ${tempoOcupada}` : ""}
            </Text>

            <Text style={styles.hSub2} numberOfLines={1}>
              {!isOnline
                ? "Offline: usando cache e fila local"
                : comandaFromCache || catalogoFromCache
                ? "Online: atualizando dados em cache"
                : mpChecking
                ? "Verificando Mercado Pago..."
                : mpConectado
                ? "Pix habilitado"
                : "Pix indisponível (MP não conectado)"}
            </Text>

            {/* ✅ Pills sem quebrar: horizontal */}
            <View style={{ marginTop: 8 }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillsRow}
              >
                {showUpdated && (
                  <View style={styles.updatedPill}>
                    <Ionicons name="flash-outline" size={12} color="#a16207" />
                    <Text style={styles.updatedText} numberOfLines={1}>
                      atualizada agora
                    </Text>
                  </View>
                )}

                <View style={[styles.pendingPill, pendingCount === 0 && styles.pendingPillZero]}>
                  <Ionicons name="hourglass-outline" size={12} color="#0f172a" />
                  <Text style={styles.pendingText} numberOfLines={1}>
                    Pendências: {pendingCount}
                  </Text>
                </View>

                <View style={[styles.pendingPill, !isOnline && { backgroundColor: "#fef3c7" }]}> 
                  <Ionicons name={isOnline ? "cloud-done-outline" : "cloud-offline-outline"} size={12} color="#0f172a" />
                  <Text style={styles.pendingText} numberOfLines={1}>
                    {isOnline ? "Servidor ativo" : "Sem internet"}
                  </Text>
                </View>

                <View style={[styles.pendingPill, { backgroundColor: "rgba(255,255,255,0.22)" }]}>
                  <Ionicons name="pricetag-outline" size={12} color="#0f172a" />
                  <Text style={styles.pendingText} numberOfLines={1}>
                    Total: {money(total)}
                  </Text>
                </View>
              </ScrollView>
            </View>
          </View>

          <Pressable
            onPress={async () => {
              setRefreshing(true);
              await fetchComanda();
              await refreshPending();
              markUpdated();
              if (restauranteId) fetchMpStatusFromApi(restauranteId);
            }}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
          </Pressable>
        </View>

        <Animated.View style={{ transform: [{ scale: headerScale }] }}>
          <View style={[styles.totalBox, showUpdated && styles.totalBoxUpdated]}>
            <View style={styles.totalLeft}>
              <Text style={styles.totalLabel}>Total da comanda</Text>
              <Text style={styles.totalValue} numberOfLines={1}>
                {money(total)}
              </Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                onPress={abrirModal}
                disabled={!pedido?._id}
                style={({ pressed }) => [
                  styles.addBtn,
                  pressed && { opacity: 0.92 },
                  !pedido?._id && { opacity: 0.55 },
                ]}
              >
                <Ionicons name="add-circle-outline" size={18} color="#0f172a" />
                <Text style={styles.addBtnText} numberOfLines={1}>
                  Adicionar
                </Text>
              </Pressable>

              {canFecharConta && !!pedido?._id && (
                <Pressable
                  onPress={() => setFecharOpen(true)}
                  style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.9 }]}
                >
                  <Ionicons name="card-outline" size={16} color="#fff" />
                  <Text style={styles.closeBtnText} numberOfLines={1}>
                    Fechar
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </Animated.View>
      </LinearGradient>

      {/* CONTENT */}
      <View style={styles.content}>
        {loading ? (
          <Text style={styles.loading}>Carregando comanda...</Text>
        ) : !pedido?._id ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Essa mesa ainda não tem comanda aberta</Text>
            <Text style={styles.emptySub}>
              Por enquanto o backend abre pelo painel. Já já a gente liga o “Abrir mesa” no app.
            </Text>
          </View>
        ) : itens.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Nenhum item lançado</Text>
            <Text style={styles.emptySub}>Toque em “Adicionar” para lançar o primeiro item.</Text>
          </View>
        ) : (
          <FlatList
            data={itens}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListHeaderComponent={
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Itens</Text>
                {showUpdated && (
                  <View style={styles.sectionBadge}>
                    <Ionicons name="flash-outline" size={12} color="#a16207" />
                    <Text style={styles.sectionBadgeText}>novo</Text>
                  </View>
                )}
              </View>
            }
            ListFooterComponent={
              <View style={styles.footerTotal}>
                <Text style={styles.footerLabel}>Total</Text>
                <Text style={styles.footerValue}>{money(total)}</Text>
              </View>
            }
          />
        )}
      </View>

      {/* MODAL ADD ITEM */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.modalCard, { width: "100%", maxWidth: 520 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Adicionar item</Text>
                <Pressable onPress={() => setModalOpen(false)}>
                  <Ionicons name="close" size={20} color="#0f172a" />
                </Pressable>
              </View>

              <View style={styles.tabsRow}>
                <TabBtn value="catalogo" label="Catálogo" icon="list-outline" />
                <TabBtn value="manual" label="Manual" icon="create-outline" />
              </View>

              {tab === "catalogo" ? (
                <>
                  <View style={styles.searchWrap}>
                    <Ionicons name="search" size={18} color="rgba(15,23,42,0.55)" />
                    <TextInput
                      value={busca}
                      onChangeText={setBusca}
                      placeholder="Buscar no catálogo"
                      placeholderTextColor="#94a3b8"
                      style={styles.searchInput}
                    />
                    {!!busca && (
                      <Pressable onPress={() => setBusca("")}>
                        <Ionicons name="close-circle" size={18} color="rgba(15,23,42,0.45)" />
                      </Pressable>
                    )}
                  </View>

                  <View style={{ marginTop: 10 }}>
                    {catLoading ? (
                      <View style={{ paddingVertical: 18, alignItems: "center" }}>
                        <ActivityIndicator />
                        <Text style={{ marginTop: 8, fontWeight: "800", color: "#64748b" }}>
                          Carregando catálogo...
                        </Text>
                      </View>
                    ) : produtosFiltrados.length === 0 ? (
                      <View style={styles.catEmpty}>
                        <Text style={styles.catEmptyTitle}>Nada por aqui</Text>
                        <Text style={styles.catEmptySub}>
                          Cadastre produtos ou verifique a rota /api/produtos/:restauranteId.
                        </Text>

                        <Pressable
                          onPress={fetchCatalogo}
                          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}
                        >
                          <Ionicons name="refresh" size={16} color="#fff" />
                          <Text style={styles.retryText}>Recarregar</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                        {produtosFiltrados.map((p) => (
                          <Pressable
                            key={safeText(p._id)}
                            onPress={() => abrirConfigProduto(p)}
                            style={({ pressed }) => [styles.prodRow, pressed && { opacity: 0.92 }]}
                          >
                            <View style={styles.prodIcon}>
                              <Ionicons name="restaurant-outline" size={18} color="#ff3b8a" />
                            </View>

                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.prodName} numberOfLines={1}>
                                {safeText(p?.nome)}
                              </Text>

                              <Text style={styles.prodSub} numberOfLines={1}>
                                {safeText(p?.categoriaNome) ? `${safeText(p?.categoriaNome)} • ` : ""}
                                {money(toNum(p?.precoBase))} • Configurar
                              </Text>
                            </View>

                            <Ionicons name="options-outline" size={20} color="#0f172a" />
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>Nome</Text>
                    <TextInput
                      value={nomeItem}
                      onChangeText={setNomeItem}
                      placeholder="Ex: Coca 2L"
                      placeholderTextColor="#94a3b8"
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.row2}>
                    <View style={[styles.field, { flex: 1 }]}>
                      <Text style={styles.label}>Qtd</Text>
                      <TextInput
                        value={qtdItem}
                        onChangeText={setQtdItem}
                        keyboardType="number-pad"
                        placeholder="1"
                        placeholderTextColor="#94a3b8"
                        style={styles.input}
                      />
                    </View>

                    <View style={[styles.field, { flex: 1 }]}>
                      <Text style={styles.label}>Preço</Text>
                      <TextInput
                        value={precoItem}
                        onChangeText={setPrecoItem}
                        keyboardType="decimal-pad"
                        placeholder="Ex: 24,90"
                        placeholderTextColor="#94a3b8"
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <Pressable
                    onPress={adicionarManual}
                    disabled={saving}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      (pressed || saving) && { opacity: 0.9 },
                      { marginTop: 14 },
                    ]}
                  >
                    <Text style={styles.primaryText}>{saving ? "Salvando..." : "Adicionar"}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ✅ MODAL FECHAR CONTA */}
      <Modal visible={fecharOpen} transparent animationType="fade" onRequestClose={() => setFecharOpen(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.modalCard, { width: "100%", maxWidth: 520 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Fechar conta</Text>
                <Pressable onPress={() => setFecharOpen(false)}>
                  <Ionicons name="close" size={20} color="#0f172a" />
                </Pressable>
              </View>

              <Text style={styles.modalSub}>Escolha a forma de pagamento.</Text>

              <Pressable
                onPress={() => {
                  setFecharOpen(false);
                  Alert.alert("Em breve", "Cartão será liberado na próxima etapa.");
                }}
                style={({ pressed }) => [styles.payOption, pressed && { opacity: 0.92 }]}
              >
                <View style={styles.payIcon}>
                  <Ionicons name="card-outline" size={18} color="#ff3b8a" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.payTitle} numberOfLines={1}>Cartão</Text>
                  <Text style={styles.paySub} numberOfLines={1}>Crédito / Débito</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
              </Pressable>

              {podeFecharDinheiro && (
                <Pressable
                  onPress={fecharEmDinheiro}
                  disabled={pixLoading}
                  style={({ pressed }) => [styles.payOption, pressed && { opacity: 0.92 }, pixLoading && { opacity: 0.45 }]}
                >
                  <View style={styles.payIcon}>
                    <Ionicons name="cash-outline" size={18} color="#ff3b8a" />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.payTitle} numberOfLines={1}>Dinheiro</Text>
                    <Text style={styles.paySub} numberOfLines={1}>Registrar no caixa aberto</Text>
                  </View>
                  {pixLoading ? <ActivityIndicator /> : <Ionicons name="chevron-forward" size={18} color="#94a3b8" />}
                </Pressable>
              )}

              <Pressable
                onPress={abrirPix}
                disabled={pixLoading}
                style={({ pressed }) => [
                  styles.payOption,
                  pressed && { opacity: 0.92 },
                  pixLoading && { opacity: 0.45 },
                ]}
              >
                <View style={styles.payIcon}>
                  <Ionicons name="qr-code-outline" size={18} color="#ff3b8a" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.payTitle} numberOfLines={1}>Pix</Text>
                  <Text style={styles.paySub} numberOfLines={2}>
                    {mpConectado ? "QR Code / Copia e cola" : "Verificando conexão Mercado Pago..."}
                  </Text>
                </View>
                {pixLoading ? <ActivityIndicator /> : <Ionicons name="chevron-forward" size={18} color="#94a3b8" />}
              </Pressable>

              <Pressable onPress={() => setFecharOpen(false)} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.9 }]}>
                <Text style={styles.ghostText}>Cancelar</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* ✅ MODAL PIX */}
      <Modal
        visible={pixOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPixOpen(false);
          setPixAutoChecking(false);
          setPixCountdown(0);
        }}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.modalCard, { width: "100%", maxWidth: 520 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Pix do cliente</Text>
                <Pressable
                  onPress={() => {
                    setPixOpen(false);
                    setPixAutoChecking(false);
                    setPixCountdown(0);
                    setPixInfo(null);
                    setPixErr("");
                    setPixStatus("");
                    setPixPaidBanner(false);
                  }}
                >
                  <Ionicons name="close" size={20} color="#0f172a" />
                </Pressable>
              </View>

              {pixPaidBanner ? (
                <View style={styles.paidBanner}>
                  <Ionicons name="checkmark-circle" size={18} color="#065f46" />
                  <Text style={styles.paidBannerText}>Pagamento recebido! Encerrando mesa…</Text>
                </View>
              ) : null}

              <View style={styles.pixInfoTop}>
                <Animated.View style={{ transform: [{ scale: totalEsperandoScale }] }}>
                  <View style={styles.waitPill}>
                    <Ionicons name="time-outline" size={14} color="#0f172a" />
                    <Text style={styles.waitText} numberOfLines={1}>
                      Aguardando pagamento {pixAutoChecking ? `• verificando em ${pixCountdown}s` : ""}
                    </Text>
                  </View>
                </Animated.View>

                <Text style={[styles.modalSub, { marginTop: 8 }]} numberOfLines={3}>
                  Mostre o QR Code ao cliente. Quando ele pagar, a mesa será fechada automaticamente.
                  {pixStatus ? ` • status: ${pixStatus}` : ""}
                </Text>
              </View>

              {pixErr ? (
                <View style={[styles.warnBox, { marginTop: 12 }]}>
                  <Ionicons name="alert-circle-outline" size={16} color="#b45309" />
                  <Text style={styles.warnText}>{pixErr}</Text>
                </View>
              ) : null}

              <View style={{ marginTop: 14, alignItems: "center" }}>
                {!!pixInfo?.qrCodeBase64 ? (
                  <Image
                    source={{ uri: `data:image/png;base64,${pixInfo.qrCodeBase64}` }}
                    style={{ width: 240, height: 240, borderRadius: 14 }}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={[styles.qrPlaceholder]}>
                    <Ionicons name="qr-code-outline" size={44} color="#ff3b8a" />
                    <Text style={{ marginTop: 10, fontWeight: "900", color: "#64748b" }}>
                      QR Code não retornou em imagem
                    </Text>
                    {!!pixInfo?.qrCode ? (
                      <Text style={{ marginTop: 6, fontWeight: "800", color: "#64748b", fontSize: 12 }}>
                        Use “Copiar código” abaixo.
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>

              {!!pixInfo?.qrCode ? (
                <View style={styles.pixCodeBox}>
                  <Text style={styles.pixCodeText} numberOfLines={2} ellipsizeMode="middle">
                    {pixInfo.qrCode}
                  </Text>
                </View>
              ) : null}

              <View style={{ marginTop: 12, gap: 10 }}>
                <Pressable onPress={copiarCopiaECola} style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.92 }]}>
                  <Ionicons name="copy-outline" size={16} color="#0f172a" />
                  <Text style={styles.copyText} numberOfLines={1}>Copiar código “copia e cola”</Text>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    await consultarPixStatus({ silent: false });
                    setPixAutoChecking(true);
                    setPixCountdown(3);
                  }}
                  disabled={pixLoading || pixPaidBanner}
                  style={({ pressed }) => [
                    styles.primaryBtnDark,
                    pressed && !pixLoading && { opacity: 0.92 },
                    (pixLoading || pixPaidBanner) && { opacity: 0.6 },
                  ]}
                >
                  {pixLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color="#fff" />
                      <Text style={styles.primaryDarkText} numberOfLines={1}>Já pagou? Atualizar agora</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => {
                    setPixAutoChecking((v) => !v);
                    setPixCountdown(3);
                  }}
                  disabled={pixPaidBanner}
                  style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.9 }, pixPaidBanner && { opacity: 0.6 }]}
                >
                  <Text style={styles.ghostText} numberOfLines={1}>
                    {pixAutoChecking ? "Pausar verificação automática" : "Ativar verificação automática"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* MODAL CONFIG PRODUTO */}
      <ModalConfigProdutoMobile
        visible={configOpen}
        produto={selected}
        onClose={() => {
          setConfigOpen(false);
          setSelected(null);
          requestAnimationFrame(() => setModalOpen(true));
        }}
        onConfirm={async (item) => {
          if (saving) return;
          await addItensMesa([item]);
        }}
      />

      {/* MODAL DETALHES ITEM */}
      <ModalItemDetails
        visible={detailsOpen}
        item={detailsItem}
        onClose={() => {
          setDetailsOpen(false);
          setDetailsItem(null);
        }}
      />
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
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
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

  hTitle: { color: "#fff", fontSize: 18, fontWeight: "900" },
  hSub: { color: "rgba(255,255,255,0.85)", marginTop: 4, fontWeight: "800" },
  hSub2: { color: "rgba(255,255,255,0.75)", marginTop: 4, fontWeight: "800", fontSize: 12 },

  pillsRow: { gap: 10, paddingRight: 10 },

  updatedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  updatedText: { fontWeight: "900", fontSize: 11, color: "#a16207" },

  pendingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.35)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.45)",
  },
  pendingPillZero: {
    opacity: 0.7,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderColor: "rgba(255,255,255,0.28)",
  },
  pendingText: { fontWeight: "900", fontSize: 11, color: "#0f172a", flexShrink: 1 },

  totalBox: {
    marginTop: 12,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  totalBoxUpdated: {
    borderColor: "rgba(245,158,11,0.55)",
    shadowColor: "#f59e0b",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
  },

  totalLeft: { flex: 1, minWidth: 160 },
  totalLabel: { color: "rgba(255,255,255,0.9)", fontWeight: "800" },
  totalValue: { color: "#fff", fontWeight: "900", fontSize: 20, marginTop: 2 },
actionsRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 10,
  flexShrink: 1,
  flexWrap: "wrap",      // ✅ se apertar, quebra linha em vez de cortar
},

  addBtn: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  addBtnText: { fontWeight: "900", color: "#0f172a" },

  closeBtn: {
    backgroundColor: "rgba(15,23,42,0.95)",
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  closeBtnText: { color: "#fff", fontWeight: "900" },

  content: {
    flex: 1,
    padding: 16,
    paddingBottom: 20,
    backgroundColor: "#f3f6fb",
  },

  sectionRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: "900", color: "#0f172a" },
  sectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.14)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
  },
  sectionBadgeText: { fontWeight: "900", fontSize: 11, color: "#a16207" },

  loading: { fontWeight: "800", color: "#0f172a", marginTop: 10 },

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

  itemRow: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 10,
  },
  itemRowPending: {
    borderColor: "rgba(245,158,11,0.45)",
    backgroundColor: "rgba(245,158,11,0.06)",
  },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(255,59,138,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  itemName: { fontWeight: "900", color: "#0f172a", flexShrink: 1 },
  itemSub: { marginTop: 4, color: "#64748b", fontWeight: "800", fontSize: 12 },
  itemResumo: { marginTop: 4, color: "#64748b", fontWeight: "700", fontSize: 12 },
  itemTotal: { fontWeight: "900", color: "#0f172a" },
  tapHint: { marginTop: 6, fontWeight: "900", fontSize: 10, color: "#94a3b8" },

  pendingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(245,158,11,0.14)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  pendingBadgeText: { fontSize: 10, fontWeight: "900", color: "#b45309" },

  customBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,59,138,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,59,138,0.22)",
  },
  customBadgeText: { fontSize: 10, fontWeight: "900", color: "#ff3b8a" },

  footerTotal: {
    marginTop: 14,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerLabel: { fontWeight: "900", color: "#64748b" },
  footerValue: { fontWeight: "900", color: "#0f172a", fontSize: 16 },

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
  modalSub: { marginTop: 4, color: "#64748b", fontWeight: "800", fontSize: 12 },

  tabsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  tabBtn: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingVertical: 10,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tabBtnActive: {
    backgroundColor: "rgba(255,59,138,0.12)",
    borderColor: "rgba(255,59,138,0.25)",
  },
  tabText: { fontWeight: "900", color: "#64748b" },
  tabTextActive: { color: "#0f172a" },

  searchWrap: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  searchInput: { flex: 1, fontWeight: "800", color: "#0f172a" },

  prodRow: {
    marginTop: 10,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  prodIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(255,59,138,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  prodName: { fontWeight: "900", color: "#0f172a" },
  prodSub: { marginTop: 2, color: "#64748b", fontWeight: "800", fontSize: 12 },

  catEmpty: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
  },
  catEmptyTitle: { fontWeight: "900", color: "#0f172a" },
  catEmptySub: { marginTop: 6, color: "#64748b", fontWeight: "700" },

  stepper: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: {
    fontWeight: "900",
    fontSize: 16,
    color: "#0f172a",
    minWidth: 24,
    textAlign: "center",
  },

  primaryBtn: {
    marginTop: 12,
    backgroundColor: "#ff3b8a",
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
    shadowColor: "#ff3b8a",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryText: { color: "#fff", fontWeight: "900" },

  primaryBtnDark: {
    backgroundColor: "#0f172a",
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.15)",
  },
  primaryDarkText: { color: "#fff", fontWeight: "900" },

  field: { marginTop: 12 },
  label: { fontWeight: "900", color: "#64748b", marginBottom: 6, fontSize: 12 },
  input: {
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    fontWeight: "800",
    color: "#0f172a",
  },
  row2: { flexDirection: "row", gap: 10 },

  retryBtn: {
    marginTop: 12,
    backgroundColor: "#ff3b8a",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  retryText: { fontWeight: "900", color: "#fff" },

  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
  },

  warnBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
    backgroundColor: "rgba(245,158,11,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  warnText: { flex: 1, fontWeight: "900", color: "#b45309" },

  block: { marginTop: 12 },
  blockTitle: { fontWeight: "900", color: "#0f172a", marginBottom: 8 },

  optRow: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  optLabel: { flex: 1, fontWeight: "800", color: "#0f172a" },
  optRight: { fontWeight: "900", color: "#0f172a" },

  configFooter: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(15,23,42,0.08)",
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  configFooterLabel: { fontWeight: "900", color: "#64748b" },
  configFooterTotal: { marginTop: 2, fontWeight: "900", color: "#0f172a", fontSize: 16 },

  payOption: {
    marginTop: 12,
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  payIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: "rgba(255,59,138,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  payTitle: { fontWeight: "900", color: "#0f172a" },
  paySub: { marginTop: 2, color: "#64748b", fontWeight: "700", fontSize: 12 },

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

  qrPlaceholder: {
    width: 240,
    height: 240,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.10)",
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  copyBtn: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(15,23,42,0.10)",
  },
  copyText: { fontWeight: "900", color: "#0f172a" },

  pixInfoTop: { marginTop: 6 },

  waitPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,59,138,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,59,138,0.22)",
  },
  waitText: { fontWeight: "900", color: "#0f172a", fontSize: 12 },

  paidBanner: {
    marginTop: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
    backgroundColor: "rgba(16,185,129,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  paidBannerText: { flex: 1, fontWeight: "900", color: "#065f46" },

  pixCodeBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  pixCodeText: { color: "#0f172a", fontWeight: "800", fontSize: 12, lineHeight: 16 },
});
