// src/pages/Checkout.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Container,
  Divider,
  CircularProgress,
  AppBar,
  Toolbar,
  Avatar,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Stack,
  Snackbar,
  Alert,
  Grid,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
} from "@mui/material";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import * as turf from "@turf/turf";
import { Helmet } from "react-helmet";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import CreditCardIcon from "@mui/icons-material/CreditCard";
import PixIcon from "@mui/icons-material/Pix";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

// ✅ Mercado Pago Brick
import { initMercadoPago, CardPayment } from "@mercadopago/sdk-react";

import { API_BASE_URL, MAPBOX_TOKEN } from "../config";

// ====== API base robusta ======
const API = API_BASE_URL;

// ====== Mapbox ======
const MAPBOX_PUBLIC_TOKEN = MAPBOX_TOKEN;

// ====== MP Public Key (trim!) ======
const MP_PUBLIC_KEY = String(import.meta.env.VITE_MP_PUBLIC_KEY || "").trim();

// ====== Constantes ======
const LS_CLIENT_PHONE_KEY = "cliente_telefone";
const CART_KEY = "carrinho";
const CART_OWNER_KEY = "carrinho_restaurante_id";
const PIX_PENDENTE_KEY = "pix_pendente";
const DEFAULT_IMAGE_URL = "";

const PIX_STATUS_URL = `${API}/publico/mercadopago/pix/status`;
const MP_STATUS_PUBLICO_URL = `${API}/mercadopago/status`;
const RESTAURANTE_PUBLICO_URL = `${API}/restaurantes/publico`;

const PIX_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CARD_FEE_RATE = 0.038;

const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
const money = (v) => Number(v || 0).toFixed(2);

const isValidEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
};

function msToMMSS(ms) {
  const s = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function getRestauranteAtualStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem("restauranteSelecionado") || "null");
    return raw?.restaurante && typeof raw.restaurante === "object" ? raw.restaurante : raw;
  } catch {
    return null;
  }
}

function readCartForCurrentRestaurant() {
  try {
    const rest = getRestauranteAtualStorage();
    const currentId = rest?._id ? String(rest._id) : "";
    const owner = String(localStorage.getItem(CART_OWNER_KEY) || "");
    const arr = JSON.parse(localStorage.getItem(CART_KEY) || "[]");

    if (currentId && owner && owner !== currentId) {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(PIX_PENDENTE_KEY);
      return [];
    }

    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * ✅ INIT MERCADO PAGO 1 VEZ (por public key)
 */
function initMpOnce() {
  if (typeof window === "undefined") return false;
  if (!MP_PUBLIC_KEY) return false;

  if (window.__MP_INITED__ && window.__MP_PK__ === MP_PUBLIC_KEY) return true;

  try {
    initMercadoPago(MP_PUBLIC_KEY, { locale: "pt-BR" });
    window.__MP_INITED__ = true;
    window.__MP_PK__ = MP_PUBLIC_KEY;
    return true;
  } catch (e) {
    console.error("Erro initMercadoPago:", e);
    return false;
  }
}

const Checkout = () => {
  const navigate = useNavigate();

  // ===== DADOS CLIENTE =====
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");

  // ===== ENDEREÇOS =====
  const [enderecosCliente, setEnderecosCliente] = useState([]);
  const [enderecoSelecionado, setEnderecoSelecionado] = useState(-1);
  const [endereco, setEndereco] = useState({
    apelido: "",
    rua: "",
    numero: "",
    bairro: "",
    cidade: "",
    estado: "",
    cep: "",
    complemento: "",
  });

  // ===== CONTROLES =====
  const [carregando, setCarregando] = useState(false);
  const [clienteCarregado, setClienteCarregado] = useState(false);

  // frete visual
  const [frete, setFrete] = useState(0);

  // congela frete no cartão
  const [freteCongelado, setFreteCongelado] = useState(null);
  const [latLngCongelado, setLatLngCongelado] = useState(null); // { lat, lng }

  // PIX
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrCodeTexto, setQrCodeTexto] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [pixStatus, setPixStatus] = useState(null);
  const [verificandoPix, setVerificandoPix] = useState(false);

  const [pixCreatedAt, setPixCreatedAt] = useState(null);
  const [pixExpiresAt, setPixExpiresAt] = useState(null);
  const [pixTimeLeftMs, setPixTimeLeftMs] = useState(0);
  const [confirmCancelarPix, setConfirmCancelarPix] = useState(false);

  // Pedido (Pix)
  const [resumoPedido, setResumoPedido] = useState({
    itens: [],
    total: 0,
    frete: 0,
    _id: null,
  });

  const [formaPagamento, setFormaPagamento] = useState("Pix");

  // Mercado Pago
  const [mpConectado, setMpConectado] = useState(false);
  const [mpCarregando, setMpCarregando] = useState(true);

  // Restaurante
  const restauranteRaw = JSON.parse(localStorage.getItem("restauranteSelecionado") || "null");
  const restauranteInicial = restauranteRaw?.restaurante ?? restauranteRaw;
  const [restaurante, setRestaurante] = useState(restauranteInicial || null);
  const [restCarregando, setRestCarregando] = useState(false);
  const [restConfirmado, setRestConfirmado] = useState(false);

  // MP init lazy
  const [mpInited, setMpInited] = useState(false);

  // RESUMO PRÉ-PAGAMENTO
  const [itensPreview, setItensPreview] = useState([]);
  const [subtotalPreview, setSubtotalPreview] = useState(0);

  // UI
  const [pixCodeOpen, setPixCodeOpen] = useState(false);
  const [resumoOpen, setResumoOpen] = useState(true);
  const [confirmEditarPix, setConfirmEditarPix] = useState(false);

  // Feedback
  const [cepErro, setCepErro] = useState(false);
  const [cepHelper, setCepHelper] = useState("");
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "info",
  });

  const pollRef = useRef(null);
  const countdownRef = useRef(null);

  // ===== FIX BRICK: lock amount + retry =====
  const [cardPreparing, setCardPreparing] = useState(false);
  const [cardAmountLocked, setCardAmountLocked] = useState(null);
  const [brickAttempt, setBrickAttempt] = useState(0);
  const [brickFatalMsg, setBrickFatalMsg] = useState("");
  const brickRetryRef = useRef(0);

  const toast = (severity, message) => setSnackbar({ open: true, severity, message });

  const telLimpo = useMemo(() => telefone.replace(/\D/g, ""), [telefone]);

  const isHttpsOk = useMemo(() => {
    if (typeof window === "undefined") return false;
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    return window.location.protocol === "https:" || isLocal;
  }, []);

  const isInIframe = useMemo(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }, []);

  const isPix = (formaPagamento || "").toLowerCase() === "pix";
  const isCard = (formaPagamento || "").toLowerCase() === "cartaocredito";

  // ✅ só considera cartão "ativo" depois que confirmamos/checamos restaurante
  const cartaoAtivoNaVitrine = useMemo(() => {
    if (!restConfirmado) return false;
    return restaurante?.pagamentoCartaoAtivo !== false;
  }, [restConfirmado, restaurante]);

  const cardFeeRate = useMemo(() => {
    const p = Number(restaurante?.taxaCartaoCreditoAvistaPercent);
    if (Number.isFinite(p) && p > 0) return p / 100;
    return DEFAULT_CARD_FEE_RATE;
  }, [restaurante]);

  // disponibilidade real
  const pixDisponivel = !!mpConectado;
  const cartaoDisponivel = !!mpConectado && cartaoAtivoNaVitrine;

  // “pagamentos carregados”
  const pagamentosCarregados = !mpCarregando && restConfirmado;

  const pixTemPedido = Boolean(resumoPedido?._id) && Boolean(qrCodeTexto || qrCodeUrl);
  const pixExpirado = useMemo(() => {
    if (!pixTemPedido) return false;
    if (!pixExpiresAt) return false;
    const st = String(pixStatus || "").toLowerCase();
    const jaPago = st === "approved" || st === "paid" || st === "pago";
    if (jaPago) return false;
    return Date.now() >= pixExpiresAt;
  }, [pixTemPedido, pixExpiresAt, pixStatus]);

  const pixAtivo = pixTemPedido && !pixExpirado;
  const travarFormulario = pixAtivo || carregando;

  const qrImgSrc = useMemo(() => {
    const s = String(qrCodeUrl || "").trim();
    if (!s) return "";
    if (s.startsWith("data:image")) return s;
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    // backend pode mandar base64 puro
    return `data:image/png;base64,${s}`;
  }, [qrCodeUrl]);

  const pixStatusNorm = useMemo(() => String(pixStatus || "").toLowerCase(), [pixStatus]);
  const pixStatusChip = useMemo(() => {
    const s = pixStatusNorm;
    if (s === "approved" || s === "paid" || s === "pago") return { label: "Aprovado", color: "success" };
    if (s === "in_process" || s === "pending" || s === "authorized") return { label: "Aguardando", color: "warning" };
    if (s === "expired" || pixExpirado) return { label: "Expirado", color: "default" };
    if (s) return { label: s, color: "default" };
    return { label: "Aguardando", color: "warning" };
  }, [pixStatusNorm, pixExpirado]);

  const handleSnackbarClose = () => setSnackbar((prev) => ({ ...prev, open: false }));

  const limparPollingPix = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const limparCountdownPix = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      limparPollingPix();
      limparCountdownPix();
    };
  }, []);

  // ===== helpers =====
  const formatarTelefone = (valor) => {
    const numeros = valor.replace(/\D/g, "");
    if (numeros.length <= 10) {
      return numeros.replace(/(\d{0,2})(\d{0,4})(\d{0,4})/, (match, ddd, p1, p2) => {
        if (!ddd) return numeros;
        if (!p1) return `(${ddd}`;
        if (!p2) return `(${ddd}) ${p1}`;
        return `(${ddd}) ${p1}-${p2}`;
      });
    }
    return numeros.replace(/(\d{0,2})(\d{0,5})(\d{0,4})/, (match, ddd, p1, p2) => {
      if (!ddd) return numeros;
      if (!p1) return `(${ddd}`;
      if (!p2) return `(${ddd}) ${p1}`;
      return `(${ddd}) ${p1}-${p2}`;
    });
  };

  const formatarCEP = (valor) => {
    const numeros = valor.replace(/\D/g, "").slice(0, 8);
    if (numeros.length <= 5) return numeros;
    return `${numeros.slice(0, 5)}-${numeros.slice(5)}`;
  };

  const calcularValorItem = (item) => {
    const qtd = Number(item.quantidade || 1);
    const precoTotal = Number(item.precoTotal || 0);
    if (precoTotal > 0) return precoTotal;

    let total = (Number(item.precoUnitario || 0) || 0) * qtd;

    if (item.bordaSelecionada) total += Number(item.bordaSelecionada.preco || 0) * qtd;
    if (item.adicionalSelecionado) total += Number(item.adicionalSelecionado.preco || 0) * qtd;

    if (Array.isArray(item.complementosSelecionados)) {
      item.complementosSelecionados.forEach((c) => {
        total += Number(c.preco || 0) * qtd;
      });
    }

    if (item.tiposExtrasSelecionados) {
      Object.values(item.tiposExtrasSelecionados).forEach((itens) => {
        (itens || []).forEach((extra) => {
          total += Number(extra?.preco || 0) * qtd;
        });
      });
    }

    return total;
  };

  // ===== BUSCA RESTAURANTE ATUALIZADO =====
  useEffect(() => {
    const id = restauranteInicial?._id || restaurante?._id;
    if (!id) return;

    const controller = new AbortController();

    (async () => {
      try {
        setRestCarregando(true);

        const { data } = await axios.get(`${RESTAURANTE_PUBLICO_URL}/${id}`, {
          signal: controller.signal,
        });

        const r = data?.restaurante ?? data;
        if (r?._id) {
          setRestaurante((prev) => ({ ...(prev || {}), ...r }));

          // atualiza localStorage
          try {
            const raw = JSON.parse(localStorage.getItem("restauranteSelecionado") || "null");
            if (raw) {
              const merged = raw?.restaurante ? { ...raw, restaurante: { ...raw.restaurante, ...r } } : { ...raw, ...r };
              localStorage.setItem("restauranteSelecionado", JSON.stringify(merged));
            }
          } catch {}

          // Se estava no cartão e backend diz off => volta pro Pix
          const ativo = r?.pagamentoCartaoAtivo !== false;
          if (!ativo) {
            setFormaPagamento("Pix");
            setFreteCongelado(null);
            setLatLngCongelado(null);
            setCardAmountLocked(null);
          }
        }
      } catch {
        // segue com cache
      } finally {
        setRestCarregando(false);
        setRestConfirmado(true);
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restauranteInicial?._id]);

  // ===== MP STATUS =====
  useEffect(() => {
    const fetchMpStatus = async () => {
      try {
        if (!restaurante?._id) {
          setMpConectado(false);
          setMpCarregando(false);
          return;
        }
        const { data } = await axios.get(`${MP_STATUS_PUBLICO_URL}/${restaurante._id}`);
        setMpConectado(!!data?.conectado);
      } catch {
        setMpConectado(false);
      } finally {
        setMpCarregando(false);
      }
    };
    fetchMpStatus();
  }, [restaurante?._id]);

  // Se está em cartão e cartão ficou indisponível, volta pro Pix e limpa lock
  useEffect(() => {
    if (!pagamentosCarregados) return;

    if (isCard && !cartaoDisponivel) {
      setFormaPagamento("Pix");
      setFreteCongelado(null);
      setLatLngCongelado(null);
      setCardAmountLocked(null);
    }

    if (isPix && !pixDisponivel) {
      if (cartaoDisponivel) setFormaPagamento("CartaoCredito");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagamentosCarregados, mpConectado, cartaoAtivoNaVitrine]);

  // init MP somente quando realmente vai usar cartão
  useEffect(() => {
    const needCard = pagamentosCarregados && isCard && cartaoDisponivel;
    if (!needCard) return;

    const ok = initMpOnce();
    setMpInited(ok);
  }, [pagamentosCarregados, isCard, cartaoDisponivel]);

  // ===== Carrinho + restore pix pendente =====
  useEffect(() => {
    const savedPhone = (localStorage.getItem(LS_CLIENT_PHONE_KEY) || "").replace(/\D/g, "");
    if (savedPhone && !telefone) setTelefone(formatarTelefone(savedPhone));

    const carrinho = readCartForCurrentRestaurant();
    setItensPreview(carrinho);

    const subtotal = carrinho.reduce((acc, item) => acc + calcularValorItem(item), 0);
    setSubtotalPreview(subtotal);

    try {
      const pend = JSON.parse(localStorage.getItem(PIX_PENDENTE_KEY) || "null");

      if (pend?.telefone) {
        const pTel = String(pend.telefone).replace(/\D/g, "");
        if (pTel) localStorage.setItem(LS_CLIENT_PHONE_KEY, pTel);
        if (pTel && !telefone) setTelefone(formatarTelefone(pTel));
      }

      if (pend?._id && (pend?.qrCodeTexto || pend?.qrCodeUrl)) {
        setResumoPedido((prev) => ({
          ...prev,
          _id: pend._id,
          total: pend.total || 0,
          frete: pend.frete || 0,
          itens: pend.itens || prev.itens || [],
        }));

        setQrCodeTexto(pend.qrCodeTexto || "");
        setQrCodeUrl(pend.qrCodeUrl || "");
        setPixStatus(pend.pixStatus || "pending");
        setFormaPagamento("Pix");

        const createdAt = Number(pend.pixCreatedAt || Date.now());
        const expiresAt = Number(pend.pixExpiresAt || createdAt + PIX_TTL_MS);

        setPixCreatedAt(createdAt);
        setPixExpiresAt(expiresAt);

        const left = expiresAt - Date.now();
        setPixTimeLeftMs(left);

        if (left > 0) {
          setPixCodeOpen(true);
          iniciarPollingPix(pend._id, expiresAt);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Countdown Pix =====
  useEffect(() => {
    limparCountdownPix();
    if (!pixTemPedido || !pixExpiresAt) return;

    countdownRef.current = setInterval(() => {
      const left = pixExpiresAt - Date.now();
      setPixTimeLeftMs(left);

      if (left <= 0) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;

        const s = String(pixStatus || "").toLowerCase();
        const jaPago = s === "approved" || s === "paid" || s === "pago";
        if (!jaPago) {
          limparPollingPix();
          setPixStatus("expired");
          toast("warning", "Pix expirou. Gere um novo Pix para continuar.");
        }
      }
    }, 1000);

    return () => limparCountdownPix();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixTemPedido, pixExpiresAt, pixStatus]);

  // ===== Buscar cliente =====
  const buscarCliente = async () => {
    const t = telLimpo;
    if (t.length < 10) return;

    try {
      const res = await axios.get(`${API}/clientes/${t}`);
      if (res.data) {
        setNome(res.data.nome || "");
        const ends = res.data.enderecos || [];
        setEnderecosCliente(ends);

        if (ends.length > 0) {
          setEnderecoSelecionado(0);
          setEndereco(ends[0]);
        }
      } else {
        setEnderecosCliente([]);
      }
      setClienteCarregado(true);
    } catch {
      setEnderecosCliente([]);
      setClienteCarregado(true);
    }
  };

  // ===== ViaCEP =====
  const buscarEnderecoPorCep = async (cepNumerico) => {
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepNumerico}/json/`);
      const data = await res.json();
      if (data.erro) return null;
      return {
        rua: data.logradouro,
        bairro: data.bairro,
        cidade: data.localidade,
        estado: data.uf,
      };
    } catch {
      return null;
    }
  };

  // ===== Geocodificação Mapbox =====
  const geocodificarEndereco = async () => {
    const fullAddress = `${endereco.rua} ${endereco.numero}, ${endereco.bairro}, ${endereco.cidade} - ${endereco.estado}, ${endereco.cep}, Brazil`;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
      fullAddress
    )}.json?access_token=${MAPBOX_PUBLIC_TOKEN}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data?.features?.length > 0) {
      const [lng, lat] = data.features[0].center;
      return [lng, lat];
    }
    throw new Error("Endereço não localizado");
  };

  // ===== Frete =====
  const calcularFrete = async (lng, lat) => {
    try {
      const res = await axios.get(`${API}/frete/dados/${restaurante._id}`);
      const { areas = [], faixasRaio = [], localizacaoRestaurante } = res.data;

      const pontoCliente = turf.point([lng, lat]);

      if (Array.isArray(areas) && areas.length > 0) {
        for (const area of areas) {
          if (!area?.coordenadas) continue;
          const poligono = turf.polygon(area.coordenadas);
          if (turf.booleanPointInPolygon(pontoCliente, poligono)) {
            return area.valor || 0;
          }
        }
      }

      if (
        localizacaoRestaurante &&
        typeof localizacaoRestaurante.longitude === "number" &&
        typeof localizacaoRestaurante.latitude === "number" &&
        Array.isArray(faixasRaio) &&
        faixasRaio.length > 0
      ) {
        const pontoRestaurante = turf.point([localizacaoRestaurante.longitude, localizacaoRestaurante.latitude]);
        const distanciaKm = turf.distance(pontoRestaurante, pontoCliente);
        const faixa = faixasRaio.find((f) => distanciaKm <= f.ate);
        return faixa ? faixa.valor || 0 : 0;
      }

      return 0;
    } catch {
      return 0;
    }
  };

  // Recalcula frete automaticamente apenas se NÃO estiver no cartão (cartão trava)
  useEffect(() => {
    const calcularFreteEndereco = async () => {
      if (!restaurante?._id) return;
      if (!endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.estado) return;

      try {
        const [lng, lat] = await geocodificarEndereco();
        const valorFrete = await calcularFrete(lng, lat);
        setFrete(valorFrete);
      } catch {
        setFrete(0);
      }
    };

    if (!pixAtivo && !isCard) calcularFreteEndereco();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    endereco.rua,
    endereco.numero,
    endereco.bairro,
    endereco.cidade,
    endereco.estado,
    restaurante?._id,
    pixAtivo,
    isCard,
  ]);

  // Endereço seleção
  const handleEnderecoChange = (index) => {
    setEnderecoSelecionado(index);
    setEndereco(enderecosCliente[index]);
    setFrete(0);

    // se trocar endereço, limpa locks do cartão
    setFreteCongelado(null);
    setLatLngCongelado(null);
    setCardAmountLocked(null);
    setBrickFatalMsg("");
    brickRetryRef.current = 0;
  };

  const adicionarEnderecoNovo = () => {
    setEnderecoSelecionado(-1);
    setEndereco({
      apelido: "",
      rua: "",
      numero: "",
      bairro: "",
      cidade: "",
      estado: "",
      cep: "",
      complemento: "",
    });
    setFrete(0);
    setFreteCongelado(null);
    setLatLngCongelado(null);
    setCardAmountLocked(null);
    setBrickFatalMsg("");
    brickRetryRef.current = 0;
  };

  // ===== Payload base (Pix / Cartão) =====
  const montarPayloadPedidoBase = async (paymentMethod = "Pix") => {
    const carrinho = readCartForCurrentRestaurant();

    if (!restaurante?._id) throw new Error("Restaurante não identificado. Volte para a vitrine.");
    if (telLimpo.length < 10 || !nome?.trim() || !endereco.rua?.trim() || carrinho.length === 0) {
      throw new Error("Preencha telefone, nome, endereço de entrega e tenha itens no carrinho.");
    }

    const valorProdutos = carrinho.reduce((acc, item) => acc + calcularValorItem(item), 0);

    let lat, lng;
    let valorFrete;

    const isCardLocal = String(paymentMethod).toLowerCase() === "cartaocredito";

    // Se cartão e já congelou, reaproveita
    if (isCardLocal && freteCongelado !== null) {
      valorFrete = Number(freteCongelado || 0);
      lat = latLngCongelado?.lat;
      lng = latLngCongelado?.lng;
    } else {
      const coords = await geocodificarEndereco();
      lng = coords[0];
      lat = coords[1];
      valorFrete = await calcularFrete(lng, lat);
    }

    const valorTotalBase = valorProdutos + valorFrete;
    setFrete(valorFrete);

    const carrinhoFormatado = carrinho.map((item) => ({
      ...item,
      amount: Math.round((calcularValorItem(item) || 0) * 100),
      description: item.nome,
      quantity: item.quantidade,
    }));

    const freteItem = {
      nome: "Entrega",
      quantidade: 1,
      precoUnitario: valorFrete,
      precoTotal: valorFrete,
      amount: Math.round(valorFrete * 100),
      description: "Entrega",
      quantity: 1,
    };

    let carrinhoFinal = [...carrinhoFormatado, freteItem];
    let valorTotalFinal = valorTotalBase;

    if (isCardLocal) {
      const taxa = round2(valorTotalBase * cardFeeRate);
      const taxaPercent = round2(cardFeeRate * 100);

      const taxaItem = {
        nome: `Taxa cartão (${taxaPercent}%)`,
        quantidade: 1,
        precoUnitario: taxa,
        precoTotal: taxa,
        amount: Math.round(taxa * 100),
        description: `Taxa cartão (${taxaPercent}%)`,
        quantity: 1,
      };

      carrinhoFinal = [...carrinhoFinal, taxaItem];
      valorTotalFinal = round2(valorTotalBase + taxa);
    }

    return {
      carrinhoComFrete: carrinhoFinal,
      valorTotal: valorTotalFinal,
      valorFrete,
      lat,
      lng,
    };
  };

  // ===== PIX =====
  const consultarStatusPix = async (pedidoId) => {
    const { data } = await axios.get(`${PIX_STATUS_URL}/${pedidoId}`);
    return data;
  };

  const iniciarPollingPix = (pedidoId, expiresAtParam) => {
    limparPollingPix();

    pollRef.current = setInterval(async () => {
      try {
        const expiresAt = Number(expiresAtParam || pixExpiresAt || 0);
        if (expiresAt && Date.now() >= expiresAt) {
          limparPollingPix();
          setVerificandoPix(false);
          return;
        }

        setVerificandoPix(true);
        const st = await consultarStatusPix(pedidoId);

        const status = st?.statusPagamento || st?.payment_status || st?.status || null;
        if (status) setPixStatus(status);

        if (st?.pago || status === "approved" || status === "pago" || status === "paid") {
          limparPollingPix();
          setVerificandoPix(false);

          localStorage.removeItem(CART_KEY);
          localStorage.removeItem(PIX_PENDENTE_KEY);

          toast("success", "Pagamento aprovado! ✅ Redirecionando...");
          const telGo = (telLimpo || localStorage.getItem(LS_CLIENT_PHONE_KEY) || "").replace(/\D/g, "");
          setTimeout(() => navigate(`/p/meus-pedidos/${telGo}`), 650);
          return;
        }
      } catch {
        setVerificandoPix(false);
      }
    }, 2500);
  };

  const resetarPixParaEditar = () => {
    limparPollingPix();
    limparCountdownPix();
    localStorage.removeItem(PIX_PENDENTE_KEY);

    setResumoPedido({ itens: [], total: 0, frete: 0, _id: null });
    setQrCodeTexto("");
    setQrCodeUrl("");
    setPixStatus(null);
    setVerificandoPix(false);

    setPixCreatedAt(null);
    setPixExpiresAt(null);
    setPixTimeLeftMs(0);

    setPixCodeOpen(false);
    toast("info", "Você pode editar os dados e gerar um novo Pix.");
  };

  const cancelarPix = async () => {
    const id = resumoPedido?._id;
    try {
      if (id) await axios.post(`${API}/publico/pedidos/${id}/cancelar-pix`).catch(() => {});
    } catch {
      // ignore
    } finally {
      resetarPixParaEditar();
      toast("success", "Pix cancelado. Você pode gerar um novo quando quiser.");
    }
  };

  const copiarPix = async () => {
    try {
      if (!qrCodeTexto) return;
      await navigator.clipboard.writeText(qrCodeTexto);
      setCopiado(true);
    } catch {
      toast("error", "Não consegui copiar o código Pix.");
    }
  };

  const verificarPixAgora = async () => {
    const id = resumoPedido?._id;
    if (!id) return;
    try {
      setVerificandoPix(true);
      const st = await consultarStatusPix(id);
      const status = st?.statusPagamento || st?.payment_status || st?.status || null;
      if (status) setPixStatus(status);
    } catch {
      // ignore
    } finally {
      setVerificandoPix(false);
    }
  };

  const finalizarPix = async () => {
    if (!pixDisponivel) {
      toast("warning", "Pix indisponível: o restaurante não está conectado ao Mercado Pago.");
      return;
    }

    setCarregando(true);
    try {
      const { carrinhoComFrete, valorTotal, valorFrete, lat, lng } = await montarPayloadPedidoBase("Pix");

      const resp = await axios.post(`${API}/pedidos/`, {
        itens: carrinhoComFrete,
        telefoneCliente: telLimpo,
        nomeCliente: nome,
        clienteEmail: isValidEmail(email) ? email.trim() : undefined,
        enderecoCliente: `${endereco.rua}, ${endereco.numero} - ${endereco.bairro}`,
        residenciaNumero: endereco.numero,
        residenciaComplemento: endereco.complemento || "",
        residenciaReferencia: "",
        residenciaBairro: endereco.bairro,
        residenciaCep: endereco.cep,
        latitudeCliente: lat,
        longitudeCliente: lng,
        valorTotal,
        restaurante: restaurante._id,
        formadePagamento: "Pix",
        origem: "vitrine",
        valorFrete,
      });

      const pedidoId = resp.data?.pedidoId || resp.data?._id || null;
      const qrText = resp.data?.pix_qr_code || resp.data?.qr_code || "";
      const qrBase64 =
        resp.data?.pix_qr_code_base64 ||
        resp.data?.qr_code_base64 ||
        resp.data?.pix_qr_code_url ||
        resp.data?.qr_code_url ||
        "";

      if (!pedidoId) {
        toast("error", "Pedido criado, mas não recebi o ID do pedido no retorno.");
        return;
      }

      if (telLimpo && telLimpo.length >= 10) localStorage.setItem(LS_CLIENT_PHONE_KEY, telLimpo);

      if (!qrText && !qrBase64) {
        toast("error", "Pedido criado, mas não recebi o QR Code Pix.");
        return;
      }

      const createdAt = Date.now();
      const expiresAt = createdAt + PIX_TTL_MS;

      setResumoPedido({
        itens: carrinhoComFrete,
        total: valorTotal,
        frete: valorFrete,
        _id: pedidoId,
      });

      setQrCodeTexto(qrText);
      setQrCodeUrl(qrBase64);
      setPixStatus("pending");

      setPixCreatedAt(createdAt);
      setPixExpiresAt(expiresAt);
      setPixTimeLeftMs(expiresAt - Date.now());

      localStorage.setItem(
        PIX_PENDENTE_KEY,
        JSON.stringify({
          _id: pedidoId,
          telefone: telLimpo,
          total: valorTotal,
          frete: valorFrete,
          itens: carrinhoComFrete,
          qrCodeTexto: qrText,
          qrCodeUrl: qrBase64,
          pixStatus: "pending",
          pixCreatedAt: createdAt,
          pixExpiresAt: expiresAt,
        })
      );

      setResumoOpen(true);
      setPixCodeOpen(true);
      toast("info", "Pix gerado! Aguardando confirmação do pagamento...");
      iniciarPollingPix(pedidoId, expiresAt);
    } catch (err) {
      console.error("Erro backend:", err?.response?.data || err);
      toast("error", err?.response?.data?.message || err?.message || "Erro ao finalizar pedido.");
    } finally {
      setCarregando(false);
    }
  };

  // ===== CARTÃO: prepara + trava amount =====
  const prepararCartao = async () => {
    if (!cartaoDisponivel) return;

    setBrickFatalMsg("");
    brickRetryRef.current = 0;

    if (!restaurante?._id) {
      toast("error", "Restaurante não identificado. Volte para a vitrine.");
      setFormaPagamento("Pix");
      return;
    }
    if (!endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.estado) {
      toast("warning", "Preencha o endereço antes de pagar no cartão.");
      setFormaPagamento("Pix");
      return;
    }
    const carrinho = readCartForCurrentRestaurant();
    if (!carrinho.length) {
      toast("warning", "Seu carrinho está vazio.");
      setFormaPagamento("Pix");
      return;
    }

    setCardPreparing(true);
    try {
      const { valorTotal, valorFrete, lat, lng } = await montarPayloadPedidoBase("CartaoCredito");

      setFreteCongelado(Number(valorFrete || 0));
      if (typeof lat === "number" && typeof lng === "number") setLatLngCongelado({ lat, lng });
      else setLatLngCongelado(null);

      const amount = Number(valorTotal || 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Valor inválido para cartão.");

      setCardAmountLocked(amount);
      setBrickAttempt((a) => a + 1);
    } catch (e) {
      console.error("prepararCartao error:", e);
      toast("error", e?.message || "Não consegui preparar o pagamento no cartão.");
      setFormaPagamento("Pix");
      setCardAmountLocked(null);
      setFreteCongelado(null);
      setLatLngCongelado(null);
    } finally {
      setCardPreparing(false);
    }
  };

  // Se alternar para Pix, limpa lock do cartão
  useEffect(() => {
    if (!isCard) {
      setCardAmountLocked(null);
      setBrickFatalMsg("");
      brickRetryRef.current = 0;
    }
  }, [isCard]);

  // ===== FINALIZAR CARTÃO =====
  const finalizarCartao = async ({ token, payment_method_id, issuer_id, installments, payer }) => {
    if (!cartaoDisponivel) {
      toast("warning", "Cartão indisponível para esta loja.");
      return;
    }

    setCarregando(true);
    try {
      const { carrinhoComFrete, valorTotal, valorFrete, lat, lng } = await montarPayloadPedidoBase("CartaoCredito");

      const resp = await axios.post(`${API}/pedidos/`, {
        itens: carrinhoComFrete,
        telefoneCliente: telLimpo,
        nomeCliente: nome,
        clienteEmail: isValidEmail(email) ? email.trim() : payer?.email || undefined,
        enderecoCliente: `${endereco.rua}, ${endereco.numero} - ${endereco.bairro}`,
        residenciaNumero: endereco.numero,
        residenciaComplemento: endereco.complemento || "",
        residenciaReferencia: "",
        residenciaBairro: endereco.bairro,
        residenciaCep: endereco.cep,
        latitudeCliente: lat,
        longitudeCliente: lng,
        valorTotal,
        restaurante: restaurante._id,
        formadePagamento: "CartaoCredito",
        origem: "vitrine",
        valorFrete,
        mpCard: {
          token,
          payment_method_id,
          issuer_id,
          installments: installments || 1,
          payer,
        },
      });

      if (telLimpo && telLimpo.length >= 10) localStorage.setItem(LS_CLIENT_PHONE_KEY, telLimpo);

      const status = String(resp.data?.statusPagamento || "").toLowerCase();

      if (status === "approved" || status === "paid") {
        localStorage.removeItem(CART_KEY);
        toast("success", "Pagamento aprovado! ✅ Redirecionando...");
        const telGo = (telLimpo || localStorage.getItem(LS_CLIENT_PHONE_KEY) || "").replace(/\D/g, "");
        setTimeout(() => navigate(`/p/meus-pedidos/${telGo}`), 650);
        return;
      }

      if (status === "in_process" || status === "pending" || status === "authorized") {
        toast("info", "Pagamento em análise. Se for aprovado, seu pedido aparecerá em Meus Pedidos.");
        return;
      }

      toast("error", "Pagamento não aprovado. Tente outro cartão.");
    } catch (err) {
      console.error("Erro cartão:", err?.response?.data || err);

      const data = err?.response?.data;
      const msg =
        data?.message ||
        data?.erro ||
        data?.details?.message ||
        data?.mp?.message ||
        (data ? JSON.stringify(data) : null) ||
        "Falha ao processar cartão.";

      toast("error", msg);
    } finally {
      setCarregando(false);
    }
  };

  const onSubmitCartao = async (formData) => {
    try {
      const token = formData?.token;
      const payment_method_id = formData?.payment_method_id;
      const issuer_id = formData?.issuer_id;

      const installments = Number(formData?.installments || 1) || 1;
      const payerEmail = String(formData?.payer?.email || "").trim();

      if (!token || !payment_method_id) {
        toast("error", "Não consegui obter token do cartão. Tente novamente.");
        return;
      }

      if (!isValidEmail(payerEmail)) {
        toast("warning", "Preencha um e-mail válido no pagamento com cartão.");
        return;
      }

      setEmail(payerEmail);

      const payer = {
        email: payerEmail,
        identification: formData?.payer?.identification,
      };

      await finalizarCartao({ token, payment_method_id, issuer_id, installments, payer });
    } catch (e) {
      console.error("onSubmitCartao error:", e);
      toast("error", "Falha ao enviar dados do cartão.");
    }
  };

  // ===== Resumo =====
  const resumoItens = useMemo(() => {
    const base = itensPreview || [];
    return base.map((it, idx) => ({
      key: `${it?.produtoId || it?._id || it?.nome || "item"}-${idx}`,
      nome: it?.nome || "Item",
      qtd: Number(it?.quantidade || 1),
      total: calcularValorItem(it),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itensPreview]);

  const maxResumo = 6;
  const resumoMostrado = resumoOpen ? resumoItens : resumoItens.slice(0, maxResumo);
  const temMaisResumo = resumoItens.length > maxResumo;

  // total base (Pix)
  const totalPreviewCalculado = subtotalPreview + frete;

  const cardFeeValue = useMemo(() => {
    if (!isCard) return 0;
    return round2(totalPreviewCalculado * cardFeeRate);
  }, [isCard, totalPreviewCalculado, cardFeeRate]);

  const totalComTaxaCartao = useMemo(() => {
    if (!isCard) return totalPreviewCalculado;
    return round2(totalPreviewCalculado + cardFeeValue);
  }, [isCard, totalPreviewCalculado, cardFeeValue]);

  // ✅ regra final de render do brick
  const podeRenderizarBrickCartao =
    pagamentosCarregados &&
    isCard &&
    cartaoDisponivel &&
    !!MP_PUBLIC_KEY &&
    isHttpsOk &&
    mpInited &&
    !isInIframe &&
    !cardPreparing &&
    Number(cardAmountLocked || 0) > 0 &&
    !brickFatalMsg;

  // ===== UI =====
  return (
    <Box display="flex" flexDirection="column" minHeight="100vh" sx={{ backgroundColor: "#f5f5f7" }}>
      <Helmet>{restaurante ? <title>{restaurante.nome} - Checkout</title> : <title>Checkout</title>}</Helmet>

      <AppBar
        position="sticky"
        elevation={1}
        sx={{
          background: "linear-gradient(90deg, #ff4b8b 0%, #ff7a3d 45%, #ffb347 100%)",
        }}
      >
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Box display="flex" alignItems="center" gap={2} minWidth={0}>
            <Avatar src={restaurante?.logoUrl || DEFAULT_IMAGE_URL} sx={{ width: 34, height: 34 }}>
              {!restaurante?.logoUrl && restaurante?.nome ? restaurante.nome[0].toUpperCase() : null}
            </Avatar>
            <Box minWidth={0}>
              <Typography variant="subtitle1" fontWeight="bold" noWrap>
                {restaurante?.nome || "Restaurante"}
              </Typography>
              {(restCarregando || mpCarregando) && (
                <Typography variant="caption" color="rgba(255,255,255,0.9)">
                  Atualizando meios de pagamento...
                </Typography>
              )}
            </Box>
          </Box>

          <Button color="inherit" onClick={() => navigate("/p/carrinho")} sx={{ textTransform: "none" }}>
            Voltar
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="sm" sx={{ py: 2.5, flex: 1 }}>
        <Typography variant="h5" fontWeight="bold" gutterBottom>
          Finalizar Pedido
        </Typography>

        <Paper sx={{ p: 2.2, borderRadius: 3, boxShadow: "0px 2px 8px rgba(15, 23, 42, 0.08)" }}>
          {/* ✅ BARRA PIX PENDENTE (voltou a opção de cancelar / ver QR) */}
          {pixTemPedido && (
            <Alert
              severity={pixExpirado ? "warning" : "info"}
              sx={{ borderRadius: 2, mb: 1.5 }}
              action={
                <Stack direction="row" spacing={1}>
                  {!pixExpirado && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setPixCodeOpen(true)}
                      sx={{ textTransform: "none" }}
                    >
                      Ver Pix
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={() => setConfirmCancelarPix(true)}
                    sx={{ textTransform: "none" }}
                  >
                    Cancelar
                  </Button>
                </Stack>
              }
            >
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Typography fontWeight={900}>Pix {pixExpirado ? "expirado" : "pendente"}</Typography>
                  <Chip size="small" label={pixStatusChip.label} color={pixStatusChip.color} />
                  {!pixExpirado && (
                    <Chip size="small" label={`Tempo: ${msToMMSS(pixTimeLeftMs)}`} variant="outlined" />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  A confirmação chega via webhook no backend e este checkout fica consultando o status automaticamente.
                </Typography>
              </Stack>
            </Alert>
          )}

          <TextField
            label="Telefone"
            fullWidth
            margin="normal"
            value={telefone}
            onChange={(e) => {
              const formatted = formatarTelefone(e.target.value);
              setTelefone(formatted);
              setClienteCarregado(false);

              const onlyDigits = formatted.replace(/\D/g, "");
              if (onlyDigits.length >= 10) localStorage.setItem(LS_CLIENT_PHONE_KEY, onlyDigits);
            }}
            onBlur={buscarCliente}
            disabled={travarFormulario}
          />

          <TextField
            label="Nome"
            fullWidth
            margin="normal"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={travarFormulario}
          />

          <TextField
            label="E-mail (opcional)"
            fullWidth
            margin="normal"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={travarFormulario}
            helperText={
              isCard ? "No cartão, o e-mail será solicitado no formulário abaixo." : "No Pix, ajuda a melhorar aprovação e contato."
            }
          />

          <Divider sx={{ my: 2 }} />

          {enderecosCliente.length > 0 && (
            <Stack direction="row" spacing={2} alignItems="center">
              <FormControl fullWidth margin="normal" disabled={travarFormulario}>
                <InputLabel id="endereco-select-label">Selecionar Endereço</InputLabel>
                <Select
                  labelId="endereco-select-label"
                  value={enderecoSelecionado}
                  label="Selecionar Endereço"
                  onChange={(e) => handleEnderecoChange(e.target.value)}
                >
                  {enderecosCliente.map((end, index) => (
                    <MenuItem key={index} value={index}>
                      {end.apelido || `${end.rua}, ${end.numero} - ${end.bairro}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                onClick={adicionarEnderecoNovo}
                variant="outlined"
                sx={{ mt: 2, whiteSpace: "nowrap", textTransform: "none" }}
                disabled={travarFormulario}
              >
                + Novo
              </Button>
            </Stack>
          )}

          <Typography variant="subtitle1" fontWeight="bold" gutterBottom sx={{ mt: 1 }}>
            Endereço de Entrega
          </Typography>

          <TextField
            label="Apelido"
            fullWidth
            margin="dense"
            value={endereco.apelido || ""}
            onChange={(e) => setEndereco({ ...endereco, apelido: e.target.value })}
            disabled={travarFormulario || (isCard && cardAmountLocked != null)}
          />

          <TextField
            label="CEP"
            fullWidth
            margin="dense"
            value={endereco.cep || ""}
            error={cepErro}
            helperText={cepHelper}
            disabled={travarFormulario || (isCard && cardAmountLocked != null)}
            onChange={async (e) => {
              const cepMascarado = formatarCEP(e.target.value);
              const cepNumerico = cepMascarado.replace(/\D/g, "");
              setEndereco((prev) => ({ ...prev, cep: cepMascarado }));
              setCepErro(false);
              setCepHelper("");

              // se editar endereço, limpa lock do cartão
              setFreteCongelado(null);
              setLatLngCongelado(null);
              setCardAmountLocked(null);
              setBrickFatalMsg("");
              brickRetryRef.current = 0;

              if (cepNumerico.length === 8) {
                const resultado = await buscarEnderecoPorCep(cepNumerico);
                if (resultado) {
                  setEndereco((prev) => ({ ...prev, ...resultado, cep: cepMascarado }));
                } else {
                  setCepErro(true);
                  setCepHelper("CEP inválido ou não encontrado.");
                }
              }
            }}
          />

          {["rua", "numero", "complemento", "bairro", "cidade", "estado"].map((campo) => (
            <TextField
              key={campo}
              label={campo.charAt(0).toUpperCase() + campo.slice(1)}
              fullWidth
              margin="dense"
              value={endereco[campo] || ""}
              onChange={(e) => {
                setEndereco({ ...endereco, [campo]: e.target.value });

                // se editar endereço, limpa lock do cartão
                setFreteCongelado(null);
                setLatLngCongelado(null);
                setCardAmountLocked(null);
                setBrickFatalMsg("");
                brickRetryRef.current = 0;
              }}
              disabled={travarFormulario || (isCard && cardAmountLocked != null)}
            />
          ))}

          <Typography variant="body2" color="success.main" sx={{ mt: 1, fontWeight: 600 }}>
            Frete estimado: R$ {money(frete)}
          </Typography>

          {/* RESUMO */}
          {itensPreview.length > 0 && (
            <Paper
              elevation={0}
              sx={{
                mt: 2,
                p: 1.4,
                bgcolor: "#fafafa",
                borderRadius: 2.5,
                border: "1px solid #e9e9e9",
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Stack direction="row" alignItems="center" gap={1}>
                  <ReceiptLongIcon fontSize="small" />
                  <Typography variant="subtitle2" fontWeight={900}>
                    Resumo
                  </Typography>
                </Stack>

                {temMaisResumo && (
                  <Button
                    size="small"
                    onClick={() => setResumoOpen((v) => !v)}
                    startIcon={resumoOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    sx={{ textTransform: "none", fontWeight: 900 }}
                  >
                    {resumoOpen ? "Menos" : "Mais"}
                  </Button>
                )}
              </Stack>

              <List dense sx={{ py: 0.5 }}>
                {resumoMostrado.map((it, idx) => (
                  <ListItem key={`${it.key}-${idx}`} disableGutters sx={{ py: 0.25 }}>
                    <ListItemText
                      primary={
                        <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={1}>
                          <Typography variant="body2" fontWeight={800} noWrap sx={{ maxWidth: "70%" }}>
                            {it.qtd}x {it.nome}
                          </Typography>
                          <Typography variant="body2" fontWeight={900}>
                            R$ {money(it.total)}
                          </Typography>
                        </Stack>
                      }
                    />
                  </ListItem>
                ))}
              </List>

              <Divider sx={{ my: 1 }} />

              <Stack spacing={0.4}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Subtotal
                  </Typography>
                  <Typography variant="body2" fontWeight={800}>
                    R$ {money(subtotalPreview)}
                  </Typography>
                </Stack>

                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    Frete
                  </Typography>
                  <Typography variant="body2" fontWeight={800}>
                    R$ {money(frete)}
                  </Typography>
                </Stack>

                {isCard && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Taxa cartão ({round2(cardFeeRate * 100)}%)
                    </Typography>
                    <Typography variant="body2" fontWeight={800}>
                      R$ {money(cardFeeValue)}
                    </Typography>
                  </Stack>
                )}

                <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.4 }}>
                  <Typography variant="body1" fontWeight={900}>
                    Total
                  </Typography>
                  <Typography variant="body1" fontWeight={900}>
                    R$ {money(isCard ? totalComTaxaCartao : totalPreviewCalculado)}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>
          )}

          {/* PAGAMENTO (se Pix já foi gerado, mantém travado e a pessoa usa o modal do Pix acima) */}
          {!pixTemPedido && (
            <Box mt={3}>
              <Grid container spacing={2} alignItems="flex-start" justifyContent="space-between">
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    Forma de Pagamento
                  </Typography>

                  {!pagamentosCarregados ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, mt: 0.5 }}>
                      <CircularProgress size={16} />
                      <Typography variant="body2" color="text.secondary">
                        Verificando pagamentos...
                      </Typography>
                    </Box>
                  ) : (
                    <RadioGroup
                      value={formaPagamento}
                      onChange={async (e) => {
                        const v = e.target.value;

                        if (String(v).toLowerCase() === "cartaocredito") {
                          if (!cartaoDisponivel) {
                            toast("warning", "Cartão indisponível para esta loja.");
                            return;
                          }
                          setFormaPagamento("CartaoCredito");
                          await prepararCartao();
                          return;
                        }

                        if (String(v).toLowerCase() === "pix") {
                          if (!pixDisponivel) {
                            toast("warning", "Pix indisponível para esta loja.");
                            return;
                          }
                          setFormaPagamento("Pix");

                          setFreteCongelado(null);
                          setLatLngCongelado(null);
                          setCardAmountLocked(null);
                          setBrickFatalMsg("");
                          brickRetryRef.current = 0;
                          return;
                        }

                        setFormaPagamento(v);
                      }}
                    >
                      {pixDisponivel ? (
                        <FormControlLabel
                          value="Pix"
                          control={<Radio />}
                          label={
                            <Box display="flex" alignItems="center" gap={1}>
                              <PixIcon color={formaPagamento === "Pix" ? "primary" : "action"} />
                              <Typography>Pix</Typography>
                              <Chip label="Disponível" size="small" color="success" sx={{ fontWeight: 900 }} />
                            </Box>
                          }
                        />
                      ) : (
                        <Alert severity="warning" sx={{ mb: 1, borderRadius: 2 }}>
                          Pix indisponível para esta loja.
                        </Alert>
                      )}

                      {cartaoDisponivel ? (
                        <FormControlLabel
                          value="CartaoCredito"
                          control={<Radio />}
                          label={
                            <Box display="flex" alignItems="center" gap={1}>
                              <CreditCardIcon color={formaPagamento === "CartaoCredito" ? "primary" : "action"} />
                              <Typography>
                                Cartão de Crédito (à vista + {round2(cardFeeRate * 100)}%)
                              </Typography>
                              <Chip label="Disponível" size="small" color="success" sx={{ fontWeight: 900 }} />
                            </Box>
                          }
                        />
                      ) : (
                        <Alert severity="info" sx={{ mb: 1, borderRadius: 2 }}>
                          Pagamento com cartão indisponível para esta loja.
                        </Alert>
                      )}
                    </RadioGroup>
                  )}
                </Grid>

                <Grid item xs={12} md={6}>
                  <Box display="flex" justifyContent="flex-end" gap={2} mt={{ xs: 1, md: 4 }}>
                    <Button variant="outlined" onClick={() => navigate("/p/carrinho")} sx={{ textTransform: "none" }}>
                      Voltar
                    </Button>

                    {isPix ? (
                      <Button
                        variant="contained"
                        onClick={finalizarPix}
                        disabled={carregando || !pagamentosCarregados || !pixDisponivel}
                        sx={{
                          textTransform: "none",
                          fontWeight: 900,
                          borderRadius: 2,
                          background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)",
                          "&:hover": {
                            opacity: 0.95,
                            background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)",
                          },
                        }}
                      >
                        {carregando ? <CircularProgress size={22} /> : "Gerar Pix"}
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        disabled
                        sx={{
                          textTransform: "none",
                          fontWeight: 900,
                          borderRadius: 2,
                          opacity: 0.7,
                          background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)",
                        }}
                      >
                        Pague no formulário abaixo
                      </Button>
                    )}
                  </Box>
                </Grid>
              </Grid>

              {/* BRICK DO CARTÃO */}
              {isCard && (
                <Box mt={2}>
                  {!pagamentosCarregados ? (
                    <Alert severity="info" sx={{ borderRadius: 2 }}>
                      Carregando meios de pagamento...
                    </Alert>
                  ) : !cartaoDisponivel ? (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      Cartão indisponível:{" "}
                      {mpConectado ? "a loja desativou cartão na vitrine." : "a loja não está conectada ao Mercado Pago."}
                    </Alert>
                  ) : !MP_PUBLIC_KEY ? (
                    <Alert severity="error" sx={{ borderRadius: 2 }}>
                      Falta configurar <b>VITE_MP_PUBLIC_KEY</b> no front (.env).
                    </Alert>
                  ) : !isHttpsOk ? (
                    <Alert severity="error" sx={{ borderRadius: 2 }}>
                      O formulário de cartão do Mercado Pago exige <b>HTTPS</b> (ou <b>localhost</b>).
                    </Alert>
                  ) : isInIframe ? (
                    <Alert severity="warning" sx={{ borderRadius: 2 }}>
                      O formulário de cartão pode falhar dentro de <b>iframe/webview</b>. Abra o checkout no navegador
                      (Chrome/Safari) fora do app.
                    </Alert>
                  ) : !mpInited ? (
                    <Alert severity="info" sx={{ borderRadius: 2 }}>
                      Preparando SDK do Mercado Pago...
                    </Alert>
                  ) : cardPreparing ? (
                    <Alert severity="info" sx={{ borderRadius: 2 }}>
                      Calculando frete/taxa e preparando cartão...
                      <Box sx={{ mt: 1 }}>
                        <CircularProgress size={18} />
                      </Box>
                    </Alert>
                  ) : brickFatalMsg ? (
                    <Alert severity="error" sx={{ borderRadius: 2 }}>
                      {brickFatalMsg}
                      <Box sx={{ mt: 1, display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            setBrickFatalMsg("");
                            brickRetryRef.current = 0;
                            setBrickAttempt((a) => a + 1);
                          }}
                          sx={{ textTransform: "none" }}
                        >
                          Tentar novamente
                        </Button>
                        <Button
                          variant="outlined"
                          onClick={() => {
                            setFormaPagamento("Pix");
                            setCardAmountLocked(null);
                          }}
                          sx={{ textTransform: "none" }}
                        >
                          Voltar para Pix
                        </Button>
                      </Box>
                    </Alert>
                  ) : podeRenderizarBrickCartao ? (
                    <Paper
                      variant="outlined"
                      sx={{
                        mt: 1,
                        p: 1.5,
                        borderRadius: 2.5,
                        bgcolor: "#fff",
                      }}
                    >
                      <Typography fontWeight={900} sx={{ mb: 1 }}>
                        Pagamento com cartão (à vista)
                      </Typography>

                      <CardPayment
                        key={`mp-card-${restaurante?._id || "x"}-${brickAttempt}-${Number(cardAmountLocked || 0)}`}
                        initialization={{
                          amount: Number(cardAmountLocked || 0),
                          payer: {
                            email: isValidEmail(email) ? email.trim() : undefined,
                          },
                        }}
                        customization={{
                          paymentMethods: {
                            minInstallments: 1,
                            maxInstallments: 1,
                            types: { excluded: ["debit_card"] },
                          },
                          visual: { hideFormTitle: true, hidePaymentButton: false },
                        }}
                        onSubmit={async (formData) => {
                          await onSubmitCartao(formData);
                        }}
                        onError={(err) => {
                          const cause = err?.cause || err?.error?.cause || err?.data?.cause;

                          console.error("MP CardPayment error:", err);

                          if (cause === "fields_setup_failed_after_3_tries" || cause === "fields_setup_failed") {
                            if (brickRetryRef.current < 1) {
                              brickRetryRef.current += 1;
                              toast("info", "Recarregando formulário do cartão...");
                              setTimeout(() => setBrickAttempt((a) => a + 1), 700);
                              return;
                            }

                            setBrickFatalMsg(
                              "Não consegui carregar o formulário do cartão (Secure Fields). " +
                                "Verifique: bloqueadores/adblock, CSP (frame-src/script-src), e tente fora de iframe/webview."
                            );
                            return;
                          }

                          toast("error", "Erro ao carregar formulário do cartão.");
                        }}
                      />

                      <Alert severity="info" sx={{ mt: 1, borderRadius: 2 }}>
                        No cartão, preencha <b>e-mail</b> e (se possível) <b>CPF</b> para melhorar a aprovação.
                      </Alert>

                      {freteCongelado !== null && (
                        <Alert severity="success" sx={{ mt: 1, borderRadius: 2 }}>
                          Frete congelado no cartão: <b>R$ {money(freteCongelado)}</b>
                        </Alert>
                      )}

                      <Alert severity="warning" sx={{ mt: 1, borderRadius: 2 }}>
                        Para alterar endereço/itens, volte para <b>Pix</b> e depois selecione cartão novamente.
                      </Alert>
                    </Paper>
                  ) : (
                    <Alert severity="info" sx={{ borderRadius: 2 }}>
                      Preparando formulário do cartão...
                    </Alert>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Paper>
      </Container>

      {/* ✅ MODAL PIX (voltou) */}
      <Dialog open={pixCodeOpen} onClose={() => setPixCodeOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} flexWrap="wrap">
            <Stack direction="row" spacing={1} alignItems="center">
              <PixIcon />
              <Typography fontWeight={900}>Pagamento Pix</Typography>
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Chip size="small" label={pixStatusChip.label} color={pixStatusChip.color} />
              {!pixExpirado && pixTemPedido && (
                <Chip size="small" variant="outlined" label={`Tempo: ${msToMMSS(pixTimeLeftMs)}`} />
              )}
              {verificandoPix && <CircularProgress size={16} />}
            </Stack>
          </Stack>
        </DialogTitle>

        <DialogContent dividers>
          {!pixTemPedido ? (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Nenhum Pix gerado ainda.
            </Alert>
          ) : pixExpirado ? (
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              Pix expirou. Você pode gerar um novo Pix.
            </Alert>
          ) : (
            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Aguardando confirmação do pagamento (webhook no backend + consulta automática aqui).
            </Alert>
          )}

          {pixTemPedido && !pixExpirado && (
            <Box sx={{ mt: 2 }}>
              {qrImgSrc ? (
                <Box
                  sx={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "center",
                    mb: 1,
                  }}
                >
                  <img
                    src={qrImgSrc}
                    alt="QR Code Pix"
                    style={{
                      width: "260px",
                      maxWidth: "80%",
                      borderRadius: 12,
                      border: "1px solid #eee",
                    }}
                  />
                </Box>
              ) : null}

              <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 0.5 }}>
                Copia e cola
              </Typography>

              <Paper
                variant="outlined"
                sx={{
                  p: 1.2,
                  borderRadius: 2,
                  bgcolor: "#fafafa",
                  wordBreak: "break-all",
                }}
              >
                <Typography variant="body2">{qrCodeTexto || "—"}</Typography>
              </Paper>

              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap">
                <Button variant="contained" onClick={copiarPix} sx={{ textTransform: "none", fontWeight: 900 }}>
                  Copiar código
                </Button>
                <Button variant="outlined" onClick={verificarPixAgora} sx={{ textTransform: "none" }}>
                  Verificar agora
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => setConfirmCancelarPix(true)}
                  sx={{ textTransform: "none" }}
                >
                  Cancelar Pix
                </Button>
              </Stack>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                Pedido: {resumoPedido?._id || "—"}
              </Typography>
            </Box>
          )}

          {pixTemPedido && pixExpirado && (
            <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
              <Button
                variant="contained"
                onClick={() => {
                  setPixCodeOpen(false);
                  resetarPixParaEditar();
                }}
                sx={{
                  textTransform: "none",
                  fontWeight: 900,
                  background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)",
                  "&:hover": { opacity: 0.95, background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)" },
                }}
              >
                Destravar e gerar novo Pix
              </Button>
            </Stack>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setPixCodeOpen(false)} sx={{ textTransform: "none" }}>
            Fechar
          </Button>
          {pixTemPedido && !pixExpirado && (
            <Button
              onClick={() => setConfirmEditarPix(true)}
              variant="outlined"
              sx={{ textTransform: "none" }}
            >
              Editar dados
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={confirmEditarPix} onClose={() => setConfirmEditarPix(false)}>
        <DialogTitle>Editar dados?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Isso vai remover o Pix pendente do navegador e destravar os campos para você editar e gerar um novo Pix.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmEditarPix(false)} sx={{ textTransform: "none" }}>
            Voltar
          </Button>
          <Button
            onClick={() => {
              setConfirmEditarPix(false);
              resetarPixParaEditar();
            }}
            variant="contained"
            sx={{
              textTransform: "none",
              fontWeight: 900,
              background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)",
              "&:hover": { opacity: 0.95, background: "linear-gradient(90deg,#ff4b8b,#ff7a3d,#ffb347)" },
            }}
          >
            Destravar e editar
          </Button>
        </DialogActions>
      </Dialog>

      {/* CONFIRMAR: CANCELAR PIX */}
      <Dialog open={confirmCancelarPix} onClose={() => setConfirmCancelarPix(false)}>
        <DialogTitle>Cancelar Pix?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Isso vai cancelar o Pix pendente (no navegador) e destravar os campos. O pedido Pix ficará cancelado.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmCancelarPix(false)} sx={{ textTransform: "none" }}>
            Voltar
          </Button>
          <Button
            onClick={async () => {
              setConfirmCancelarPix(false);
              await cancelarPix();
            }}
            color="error"
            variant="contained"
            sx={{ textTransform: "none", fontWeight: 900, borderRadius: 2 }}
          >
            Cancelar Pix
          </Button>
        </DialogActions>
      </Dialog>

      {/* SNACKBAR PIX COPIADO */}
      <Snackbar
        open={copiado}
        autoHideDuration={1800}
        onClose={() => setCopiado(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setCopiado(false)} severity="success" sx={{ width: "100%" }}>
          Código Pix copiado!
        </Alert>
      </Snackbar>

      {/* SNACKBAR GERAL */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Checkout;
