// src/pages/Publico.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Typography,
  Avatar,
  Box,
  Button,
  Paper,
  BottomNavigation,
  BottomNavigationAction,
  Fade,
  Container,
  Divider,
  IconButton,
  Chip,
  Snackbar,
  Alert,
  Badge,
  Stack,
  Skeleton,
  TextField,
  InputAdornment,
  Tooltip,
  useMediaQuery,
} from "@mui/material";
import { Helmet } from "react-helmet";
import HomeIcon from "@mui/icons-material/Home";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import ListAltIcon from "@mui/icons-material/ListAlt";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import AddShoppingCartIcon from "@mui/icons-material/AddShoppingCart";
import StarIcon from "@mui/icons-material/Star";
import StorefrontIcon from "@mui/icons-material/Storefront";

import ModalProduto from "../components/ModalProduto";
import axios from "axios";
import { API_BASE_URL } from "../config";
import { calcularStatusLoja } from "../utils/horarioLoja";

const DEFAULT_IMAGE_URL =
  "https://cdn-icons-png.flaticon.com/512/1404/1404945.png";

const API_URL = API_BASE_URL;

// ✅ chaves do storage (controle por restaurante)
const CART_KEY = "carrinho";
const CART_OWNER_KEY = "carrinho_restaurante_id";
const PIX_PENDENTE_KEY = "pix_pendente";

function readCartSafe() {
  try {
    const arr = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * ✅ Se trocou de restaurante:
 * - limpa carrinho
 * - limpa pix pendente (pra não "vazar" checkout)
 * - seta o dono do carrinho
 */
function syncCartOwnerOrReset(restId) {
  if (!restId) return;

  const restStr = String(restId);
  const owner = String(localStorage.getItem(CART_OWNER_KEY) || "");

  // se existe owner e é diferente -> zera
  if (owner && owner !== restStr) {
    localStorage.removeItem(CART_KEY);
    localStorage.removeItem(PIX_PENDENTE_KEY);
  }

  // se não existe owner, mas existe carrinho -> zera (defensivo, evita "vazamento" antigo)
  if (!owner) {
    const cart = readCartSafe();
    if (cart.length > 0) {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(PIX_PENDENTE_KEY);
    }
  }

  localStorage.setItem(CART_OWNER_KEY, restStr);
}

/**
 * ✅ Normaliza SEMPRE para "objeto restaurante puro"
 */
function normalizarRestaurante(qualquerCoisa) {
  if (!qualquerCoisa) return null;

  if (qualquerCoisa.restaurante && typeof qualquerCoisa.restaurante === "object") {
    return qualquerCoisa.restaurante;
  }

  return qualquerCoisa;
}

function parseMoney(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d,.-]/g, "");
    const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getItemBasePrice(item = {}) {
  return parseMoney(
    item.precoBase ??
      item.preco ??
      item.valor ??
      item.precoFinal ??
      item.price ??
      item.amount ??
      item.valorUnitario
  );
}

function formatBRL(value) {
  const num = parseMoney(value);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * ✅ Inferência robusta do tipo (evita quebrar quando categoria.tipo vem errado)
 */
function inferCategoriaType(categoria, item) {
  if (categoria?.pizzaMultisabor) return "pizza";
  if (item?.pizzaMultisabor) return "pizza";
  if (categoria?.permiteSabores) return "pizza";
  if ((item?.sabores || []).length > 0) return "pizza";
  return categoria?.tipo || "simple_item";
}

/**
 * ✅ Decide se deve mostrar "a partir de"
 */
function shouldShowAPartirDe({ categoria, item, categoriaType }) {
  const sabores = item?.sabores || [];
  const isPizza = categoriaType === "pizza";
  const isMulti = Boolean(categoria?.pizzaMultisabor) || Boolean(item?.pizzaMultisabor);
  return isPizza && (isMulti || sabores.length > 1);
}

/**
 * ✅ Detecta “pizza 2 sabores” mesmo que venha sem flags
 * (usa categoria.tipo / categoria.nome / item.nome como fallback)
 */
function detectarPizza2Sabores(categoria, item) {
  const tipo = String(categoria?.tipo || "").toLowerCase();
  const nomeCat = String(categoria?.nome || "").toLowerCase();
  const nomeItem = String(item?.nome || "").toLowerCase();

  const txt = `${tipo} ${nomeCat} ${nomeItem}`;

  // exemplos: "pizza 2 sabores", "pizza 2", "2 sabores", "meio a meio", "metade"
  const tem2 = /\b2\b/.test(txt) || txt.includes("dois");
  const falaSabores = txt.includes("sabor") || txt.includes("sabores");
  const falaMeioMeio = txt.includes("meio a meio") || txt.includes("meio-meio") || txt.includes("metade");

  // se já é pizza e menciona 2+sabores, ou menciona meio a meio
  const ehPizza = inferCategoriaType(categoria, item) === "pizza";
  return ehPizza && ((tem2 && falaSabores) || falaMeioMeio);
}

const Publico = () => {
  const navigate = useNavigate();
  const { slug } = useParams();

  const [restaurante, setRestaurante] = useState(null);
  const [produtosRaw, setProdutosRaw] = useState([]);

  const sectionRefs = useRef([]);
  const stickyRef = useRef(null);
  const categoriasScrollRef = useRef(null);

  // ✅ Destaques (scroll lateral)
  const destaquesScrollRef = useRef(null);
  const [destaqueIndex, setDestaqueIndex] = useState(0);
  const isDraggingDestaquesRef = useRef(false);
  const autoplayRef = useRef(null);

  const [modalAberto, setModalAberto] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);

  const [quantidadeCarrinho, setQuantidadeCarrinho] = useState(0);
  const [statusLoja, setStatusLoja] = useState("...");
  const [avisoFechadoOpen, setAvisoFechadoOpen] = useState(false);
  const [avisoMensagem, setAvisoMensagem] = useState("");
  const [loadingProdutos, setLoadingProdutos] = useState(true);

  // UX
  const [busca, setBusca] = useState("");
  const [categoriaAtiva, setCategoriaAtiva] = useState(0);
  const [headerCompacto, setHeaderCompacto] = useState(false);

  const isMobile = useMediaQuery("(max-width:600px)");
  const lojaAberta = statusLoja === "Aberto";

  // ✅ Contador do “Próximo em Xs”
  const [destaqueCountdown, setDestaqueCountdown] = useState(10);

  // ======= Carrinho contador =======
  useEffect(() => {
    const atualizarQuantidade = () => {
      const carrinho = JSON.parse(localStorage.getItem(CART_KEY) || "[]") || [];
      const total = carrinho.reduce((acc, item) => acc + (item.quantidade || 0), 0);
      setQuantidadeCarrinho(total);
    };

    atualizarQuantidade();
    const intervalo = setInterval(atualizarQuantidade, 1200);
    return () => clearInterval(intervalo);
  }, []);

  // ======= Header compacto ao rolar =======
  useEffect(() => {
    const onScroll = () => setHeaderCompacto(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ======= Fetch restaurante/produtos =======
  useEffect(() => {
    const restauranteData = localStorage.getItem("restauranteSelecionado");

    if (!restauranteData && !slug) {
      navigate("/erro", { replace: true });
      return;
    }

    const restauranteLSRaw = restauranteData ? JSON.parse(restauranteData) : null;
    const restauranteLS = normalizarRestaurante(restauranteLSRaw);

    const slugEfetivo = slug || restauranteLS?.slugIdentificador || restauranteLS?.slug || null;

    if (!slugEfetivo) {
      navigate("/erro", { replace: true });
      return;
    }

    // ✅ evita "flash" de restaurante errado:
    // só usa restaurante do LS se não tiver slug na URL ou se bater com o slug atual
    const slugLS = restauranteLS?.slugIdentificador || restauranteLS?.slug || null;

    // ✅ Se o cliente saiu de /p/movyo para /p/jrlanches, limpa imediatamente
    // antes mesmo da API responder. Isso impede carrinho/PIX de uma loja aparecer na outra.
    if (slug && slugLS && String(slugLS).toLowerCase() !== String(slug).toLowerCase()) {
      localStorage.removeItem(CART_KEY);
      localStorage.removeItem(CART_OWNER_KEY);
      localStorage.removeItem(PIX_PENDENTE_KEY);
      setQuantidadeCarrinho(0);
    }

    const podeUsarLS = !slug || (slugLS && String(slugLS).toLowerCase() === String(slug).toLowerCase());

    if (podeUsarLS && restauranteLS) {
      setRestaurante(restauranteLS);
      setStatusLoja(calcularStatusLoja(restauranteLS));
      // ⚠️ só sincroniza carrinho com LS se for o mesmo slug da URL
      if (restauranteLS?._id) syncCartOwnerOrReset(restauranteLS._id);
    } else {
      setRestaurante(null);
      setStatusLoja("...");
    }

    const fetchTudo = async () => {
      try {
        setLoadingProdutos(true);

        const res = await axios.get(`${API_URL}/restaurantes/${slugEfetivo}`);
        const restauranteFresh = normalizarRestaurante(res.data);

        if (!restauranteFresh) {
          navigate("/erro", { replace: true });
          return;
        }

        // ✅ AQUI: se mudou restaurante, zera carrinho imediatamente
        if (restauranteFresh?._id) {
          const owner = String(localStorage.getItem(CART_OWNER_KEY) || "");
          if (owner && owner !== String(restauranteFresh._id)) {
            // zera a badge na hora (o interval também atualiza depois)
            setQuantidadeCarrinho(0);
          }
          syncCartOwnerOrReset(restauranteFresh._id);
        }

        let produtosPorCategoria =
          res.data?.produtosPorCategoria || restauranteFresh?.produtosPorCategoria || [];

        // ✅ Correção crítica: algumas versões da API pública /restaurantes/:slug
        // retornavam precoBase vazio, mesmo com preço salvo no produto.
        // Buscamos a rota de produtos do restaurante e mesclamos preço/dados pelo _id.
        try {
          if (restauranteFresh?._id) {
            const produtosRes = await axios.get(`${API_URL}/produtos/${restauranteFresh._id}`);
            const produtosLista = Array.isArray(produtosRes.data) ? produtosRes.data : [];
            const produtosMap = new Map(produtosLista.map((p) => [String(p._id), p]));

            produtosPorCategoria = (produtosPorCategoria || []).map((cat) => ({
              ...cat,
              itens: (cat.itens || []).map((item) => {
                const completo = produtosMap.get(String(item._id));
                if (!completo) return item;

                const precoCorrigido = getItemBasePrice(completo) || getItemBasePrice(item);
                return {
                  ...item,
                  ...completo,
                  categoriaType: item.categoriaType || cat.tipo || completo.categoriaType,
                  pizzaMultisabor: item.pizzaMultisabor ?? cat.pizzaMultisabor ?? completo.pizzaMultisabor,
                  calculoPrecoPor: item.calculoPrecoPor || cat.calculoPrecoPor || completo.calculoPrecoPor,
                  maxSabores: item.maxSabores || cat.maxSabores || completo.maxSabores,
                  preco: precoCorrigido,
                  precoBase: precoCorrigido,
                };
              }),
            }));
          }
        } catch (precoErr) {
          console.warn("Não foi possível sincronizar preços pela rota /produtos:", precoErr);
        }

        let restauranteComHorario = restauranteFresh;
        try {
          if (restauranteFresh?._id) {
            const horarioRes = await axios.get(`${API_URL}/restaurantes/horario/${restauranteFresh._id}`);
            restauranteComHorario = { ...restauranteFresh, ...(horarioRes.data || {}) };
          }
        } catch (horarioErr) {
          console.warn("Não foi possível sincronizar horário público:", horarioErr);
        }

        localStorage.setItem("restauranteSelecionado", JSON.stringify(restauranteComHorario));

        setRestaurante(restauranteComHorario);
        setStatusLoja(calcularStatusLoja(restauranteComHorario));

        const categoriasBase = (produtosPorCategoria || []).filter((cat) => cat.ativa !== false);

        const categoriasComItensFiltrados = categoriasBase.map((cat) => ({
          ...cat,
          itens: (cat.itens || [])
            .map((prod) => ({
              ...prod,
              precoBase: getItemBasePrice(prod),
              preco: getItemBasePrice(prod),
            }))
            .filter((prod) => prod.ativo !== false)
            .sort((a, b) => (a.ordem || 0) - (b.ordem || 0)),
        }));

        const categoriasComProdutos = categoriasComItensFiltrados.filter(
          (cat) => cat.itens && cat.itens.length > 0
        );

        setProdutosRaw(categoriasComProdutos);
      } catch (err) {
        console.error("Erro ao buscar produtos/restaurante:", err);
        navigate("/erro", { replace: true });
      } finally {
        setLoadingProdutos(false);
      }
    };

    fetchTudo();
  }, [navigate, slug]);

  // ======= Status atualiza sozinho =======
  useEffect(() => {
    if (!restaurante) return;
    const tick = () => setStatusLoja(calcularStatusLoja(restaurante));
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, [restaurante]);

  // ======= Busca (derivado) =======
  const produtos = useMemo(() => {
    const termo = (busca || "").trim().toLowerCase();
    if (!termo) return produtosRaw;

    return (produtosRaw || [])
      .map((cat) => {
        const itens = (cat.itens || []).filter((item) => {
          const nome = (item.nome || "").toLowerCase();
          const desc = (item.descricao || "").toLowerCase();
          const tag = (item.tag || "").toLowerCase();
          return nome.includes(termo) || desc.includes(termo) || tag.includes(termo);
        });
        return { ...cat, itens };
      })
      .filter((cat) => (cat.itens || []).length > 0);
  }, [produtosRaw, busca]);

  const totalItensEncontrados = useMemo(() => {
    return (produtos || []).reduce((acc, cat) => acc + (cat.itens?.length || 0), 0);
  }, [produtos]);

  // ✅ Destaques (derivado do RAW; robusto p/ boolean/string/number)
  const destaques = useMemo(() => {
    const termo = (busca || "").trim().toLowerCase();
    const all = [];

    for (const cat of produtosRaw || []) {
      for (const item of cat.itens || []) {
        const isDestaque =
          item?.destaque === true ||
          item?.destaque === "true" ||
          item?.destaque === 1 ||
          item?.destaque === "1";

        if (!isDestaque) continue;

        if (termo) {
          const nome = (item.nome || "").toLowerCase();
          const desc = (item.descricao || "").toLowerCase();
          const tag = (item.tag || "").toLowerCase();
          const match = nome.includes(termo) || desc.includes(termo) || tag.includes(termo);
          if (!match) continue;
        }

        all.push({ item, categoria: cat });
      }
    }

    all.sort((a, b) => Number(a.item?.ordem || 0) - Number(b.item?.ordem || 0));
    return all;
  }, [produtosRaw, busca]);

  // ✅ helper: centraliza um card por índice (snap forte)
  const scrollToDestaqueIndex = (idx, behavior = "smooth") => {
    const container = destaquesScrollRef.current;
    if (!container) return;

    const cards = container.querySelectorAll("[data-destaque-card='1']");
    if (!cards || !cards.length) return;

    const safeIdx = ((idx % cards.length) + cards.length) % cards.length;
    const el = cards[safeIdx];

    const left = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;

    container.scrollTo({ left, behavior });
    setDestaqueIndex(safeIdx);

    // ✅ reinicia o contador sempre que troca
    setDestaqueCountdown(10);
  };

  // ✅ inicializa no primeiro destaque quando carregar
  useEffect(() => {
    if (!loadingProdutos && destaques.length > 0) {
      scrollToDestaqueIndex(0, "auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingProdutos, destaques.length]);

  // ✅ autoplay com contador “Próximo em Xs” (pausa no modal e durante drag)
  useEffect(() => {
    if (autoplayRef.current) clearInterval(autoplayRef.current);

    if (loadingProdutos) return;
    if (!destaques.length) return;

    // se modal aberto, não conta
    if (modalAberto) {
      setDestaqueCountdown(10);
      return;
    }

    autoplayRef.current = setInterval(() => {
      if (isDraggingDestaquesRef.current) return;

      setDestaqueCountdown((prev) => {
        if (prev <= 1) {
          scrollToDestaqueIndex(destaqueIndex + 1);
          return 10;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
    };
  }, [loadingProdutos, destaques.length, modalAberto, destaqueIndex]);

  // botões
  const scrollDestaquesLeft = () => scrollToDestaqueIndex(destaqueIndex - 1);
  const scrollDestaquesRight = () => scrollToDestaqueIndex(destaqueIndex + 1);

  // ======= Categoria ativa via IntersectionObserver =======
  useEffect(() => {
    if (!produtos || produtos.length === 0) return;

    const refs = sectionRefs.current.filter(Boolean);
    if (refs.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visiveis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));

        if (visiveis[0]) {
          const idx = refs.findIndex((r) => r === visiveis[0].target);
          if (idx >= 0) setCategoriaAtiva(idx);
        }
      },
      {
        root: null,
        rootMargin: "-160px 0px -60% 0px",
        threshold: [0.08, 0.2, 0.35],
      }
    );

    refs.forEach((r) => obs.observe(r));
    return () => obs.disconnect();
  }, [produtos]);

  // centraliza categoria selecionada
  useEffect(() => {
    const container = categoriasScrollRef.current;
    const btn = container?.querySelector?.(`[data-cat-index="${categoriaAtiva}"]`);
    if (!container || !btn) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const offset =
      btnRect.left - containerRect.left - containerRect.width / 2 + btnRect.width / 2;

    container.scrollBy({ left: offset, behavior: "smooth" });
  }, [categoriaAtiva]);

  const renderAvatar = (size = 40) => {
    if (restaurante?.logoUrl) {
      return (
        <Avatar src={restaurante.logoUrl} sx={{ width: size, height: size, bgcolor: "#fff" }} />
      );
    } else if (restaurante?.nome) {
      const initials = restaurante.nome
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      return <Avatar sx={{ width: size, height: size }}>{initials || "R"}</Avatar>;
    }
    return <Avatar src={DEFAULT_IMAGE_URL} sx={{ width: size, height: size, bgcolor: "#fff" }} />;
  };

  const getStickyHeight = () => stickyRef.current?.getBoundingClientRect?.().height || 160;

  const scrollToSection = (index) => {
    const ref = sectionRefs.current[index];
    if (!ref) return;

    const offsetTop = ref.offsetTop;
    const headerOffset = getStickyHeight() + 8;
    window.scrollTo({ top: offsetTop - headerOffset, behavior: "smooth" });
  };

  const scrollLeft = () => {
    if (categoriasScrollRef.current) {
      categoriasScrollRef.current.scrollBy({ left: -240, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (categoriasScrollRef.current) {
      categoriasScrollRef.current.scrollBy({ left: 240, behavior: "smooth" });
    }
  };

  /**
   * ✅ AJUSTE AQUI: garante pizza 2 sabores -> checkbox (maxSabores=2)
   * mesmo que categoria venha sem pizzaMultisabor/maxSabores
   */
  const abrirModalProduto = (item, categoria) => {
    if (!lojaAberta) {
      setAvisoMensagem(
        "Restaurante fechado no momento. Não é possível adicionar itens ao carrinho."
      );
      setAvisoFechadoOpen(true);
      return;
    }

    const categoriaType = inferCategoriaType(categoria, item);

    const tiposExtrasCorrigidos = (item.tiposExtras || []).map((extra) => ({
      ...extra,
      itens: item.extras?.[extra.nome] || [],
    }));

    const ehPizza2 = detectarPizza2Sabores(categoria, item);

    const pizzaMultisabor =
      Boolean(categoria?.pizzaMultisabor) ||
      Boolean(item?.pizzaMultisabor) ||
      ehPizza2;

    const maxSabores =
      Number(categoria?.maxSabores || item?.maxSabores) ||
      (pizzaMultisabor ? 2 : 1);

    setProdutoSelecionado({
      ...item,
      precoBase: getItemBasePrice(item),
      categoriaType,

      pizzaMultisabor,
      calculoPrecoPor: categoria?.calculoPrecoPor || item?.calculoPrecoPor || "maior",
      maxSabores,

      saboresDisponiveis: item.sabores || [],
      bordasDisponiveis: item.bordas || [],
      complementos: item.complementos || [],
      adicionais: item.adicionais || [],
      tiposExtras: tiposExtrasCorrigidos,

      categoriaNome: categoria?.nome || "",
    });

    setDestaqueCountdown(10);
    setModalAberto(true);
  };

  const getPrecoLabel = (item, categoria, categoriaType) => {
    const sabores = item?.sabores || [];

    if (shouldShowAPartirDe({ categoria, item, categoriaType }) && sabores.length > 0) {
      const precos = sabores.map((s) => getItemBasePrice(s)).filter((v) => v > 0);
      if (precos.length > 0) return `a partir de ${formatBRL(Math.min(...precos))}`;
    }

    const preco = getItemBasePrice(item);
    return preco > 0 ? formatBRL(preco) : "Consultar valor";
  };

  const chipsInfo = useMemo(() => {
    const list = [];

    if (restaurante?.tempoEntrega) list.push({ key: "tempo", label: `${restaurante.tempoEntrega} min` });
    if (restaurante?.taxaEntrega != null)
      list.push({ key: "taxa", label: `Entrega ${formatBRL(restaurante.taxaEntrega)}` });
    if (restaurante?.pedidoMinimo != null)
      list.push({ key: "min", label: `Mín. ${formatBRL(restaurante.pedidoMinimo)}` });

    return list;
  }, [restaurante]);

  // ✅ Progresso da barrinha (0..100)
  const progressPct = useMemo(() => {
    const pct = (destaqueCountdown / 10) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [destaqueCountdown]);

  return (
    <Box sx={{ pb: 10, backgroundColor: "#f5f5f7", minHeight: "100vh" }}>
      <Helmet>
        {restaurante ? <title>{restaurante.nome} - Faça seu pedido</title> : <title>Movyo Delivery</title>}
      </Helmet>

      {/* APPBAR */}
      <AppBar
        position="sticky"
        elevation={2}
        sx={{
          zIndex: 1201,
          background: "linear-gradient(135deg, #111827 0%, #1f2937 48%, #ff7a3d 100%)",
        }}
      >
        <Toolbar
          sx={{
            px: 2,
            minHeight: headerCompacto ? 56 : 64,
            transition: "min-height 150ms ease",
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Box display="flex" alignItems="center" gap={1.5} sx={{ flex: 1, minWidth: 0 }}>
            {renderAvatar(headerCompacto ? 32 : 36)}
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="subtitle1"
                fontWeight={900}
                noWrap
                sx={{ color: "#fff", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {restaurante?.nome || "Movyo"}
              </Typography>

              {!headerCompacto && restaurante?.enderecoBairro && (
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.88)" }} noWrap>
                  {restaurante.enderecoBairro}
                  {restaurante.enderecoCidade ? ` • ${restaurante.enderecoCidade}` : ""}
                </Typography>
              )}
            </Box>
          </Box>

          <Chip
            icon={<AccessTimeIcon fontSize="small" />}
            label={statusLoja === "..." ? "Verificando" : statusLoja}
            size="small"
            sx={{
              bgcolor: lojaAberta ? "#2e7d32" : "#c62828",
              color: "#fff",
              fontWeight: 800,
              "& .MuiChip-icon": { color: "#fff" },
              borderRadius: "999px",
            }}
          />
        </Toolbar>

        {!headerCompacto && chipsInfo.length > 0 && (
          <Box sx={{ px: 2, pb: 1 }}>
            <Stack direction="row" spacing={1} sx={{ overflowX: "auto" }}>
              {chipsInfo.map((c) => (
                <Chip
                  key={c.key}
                  label={c.label}
                  size="small"
                  sx={{
                    bgcolor: "rgba(255,255,255,0.18)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,0.22)",
                    fontWeight: 700,
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}
      </AppBar>

      {/* STICKY (Busca + categorias) */}
      <Box
        ref={stickyRef}
        sx={{
          position: "sticky",
          top: headerCompacto ? 56 : 64,
          zIndex: 1100,
          backgroundColor: "#f5f5f7",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        {/* Busca */}
        <Box sx={{ px: 2, pt: 1.25, pb: 1 }}>
          <TextField
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no cardápio (ex: pizza, suco, combo...)"
            fullWidth
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: busca ? (
                <InputAdornment position="end">
                  <Tooltip title="Limpar busca">
                    <IconButton size="small" onClick={() => setBusca("")}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : null,
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "999px",
                bgcolor: "#fff",
              },
            }}
          />

          {!loadingProdutos && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
              {busca
                ? `${totalItensEncontrados} item(s) encontrado(s) para “${busca.trim()}”`
                : "Dica: use a busca pra achar rapidinho qualquer item."}
            </Typography>
          )}
        </Box>

        {/* Categorias */}
        <Box sx={{ display: "flex", alignItems: "center", px: 1, pb: 1 }}>
          <IconButton onClick={scrollLeft} size="small" aria-label="Categorias anteriores">
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>

          <Box
            ref={categoriasScrollRef}
            sx={{
              overflowX: "auto",
              display: "flex",
              gap: 1,
              whiteSpace: "nowrap",
              flex: 1,
              scrollbarWidth: "none",
              "&::-webkit-scrollbar": { display: "none" },
              px: 0.5,
              scrollSnapType: "x mandatory",
            }}
          >
            {produtos.map((categoria, i) => {
              const selected = i === categoriaAtiva;
              return (
                <Button
                  key={categoria._id || i}
                  data-cat-index={i}
                  variant={selected ? "contained" : "outlined"}
                  size="small"
                  onClick={() => scrollToSection(i)}
                  title={categoria.nome}
                  sx={{
                    scrollSnapAlign: "center",
                    borderRadius: "999px",
                    textTransform: "none",
                    px: 2,
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "0.8rem",
                    minHeight: "34px",
                    flexShrink: 0,
                    bgcolor: selected ? "#ff7a3d" : "#ffffff",
                    color: selected ? "#fff" : "inherit",
                    borderColor: selected ? "#ff7a3d" : "#ff7a3d33",
                    boxShadow: selected ? "0 6px 16px rgba(255,122,61,0.25)" : "none",
                    "&:hover": {
                      borderColor: "#ff7a3d",
                      backgroundColor: selected ? "#ff6b2a" : "#fff7f2",
                    },
                  }}
                >
                  {categoria.nome}
                  {categoria?.itens?.length ? (
                    <Box
                      component="span"
                      sx={{ ml: 1, opacity: selected ? 0.95 : 0.65, fontWeight: 800 }}
                    >
                      • {categoria.itens.length}
                    </Box>
                  ) : null}
                </Button>
              );
            })}
          </Box>

          <IconButton onClick={scrollRight} size="small" aria-label="Próximas categorias">
            <ArrowForwardIosIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* ✅ DESTAQUES FORA DO STICKY */}
      {!loadingProdutos && destaques.length > 0 && (
        <Box sx={{ pt: 1.2, pb: 1.2 }}>
          <Box sx={{ px: 2, mb: 0.8, display: "flex", alignItems: "center", gap: 1 }}>
            <Chip
              icon={<StarIcon sx={{ color: "#fff !important" }} fontSize="small" />}
              label="Destaques"
              size="small"
              sx={{
                bgcolor: "#111827",
                color: "#fff",
                fontWeight: 900,
                borderRadius: "999px",
              }}
            />

            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800, display: "block" }}>
                Próximo em {destaqueCountdown}s
              </Typography>

              <Box
                sx={{
                  mt: 0.4,
                  width: 140,
                  height: 6,
                  borderRadius: 999,
                  bgcolor: "rgba(0,0,0,0.08)",
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    height: "100%",
                    width: `${progressPct}%`,
                    bgcolor: "#ff7a3d",
                    borderRadius: 999,
                    transition: "width 300ms linear",
                  }}
                />
              </Box>
            </Box>

            <Box sx={{ ml: "auto", display: "flex", gap: 0.5 }}>
              <IconButton onClick={scrollDestaquesLeft} size="small" aria-label="Destaques anteriores">
                <ArrowBackIosNewIcon fontSize="small" />
              </IconButton>
              <IconButton onClick={scrollDestaquesRight} size="small" aria-label="Próximos destaques">
                <ArrowForwardIosIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          {/* Wrapper com gradiente lateral */}
          <Box
            sx={{
              position: "relative",
              "&:before, &:after": {
                content: '""',
                position: "absolute",
                top: 0,
                bottom: 0,
                width: 32,
                zIndex: 3,
                pointerEvents: "none",
              },
              "&:before": {
                left: 0,
                background:
                  "linear-gradient(90deg, rgba(245,245,247,1) 0%, rgba(245,245,247,0) 100%)",
              },
              "&:after": {
                right: 0,
                background:
                  "linear-gradient(270deg, rgba(245,245,247,1) 0%, rgba(245,245,247,0) 100%)",
              },
            }}
          >
            <Box
              ref={destaquesScrollRef}
              onPointerDown={() => (isDraggingDestaquesRef.current = true)}
              onPointerUp={() => (isDraggingDestaquesRef.current = false)}
              onPointerCancel={() => (isDraggingDestaquesRef.current = false)}
              onPointerLeave={() => (isDraggingDestaquesRef.current = false)}
              sx={{
                px: 2,
                overflowX: "auto",
                display: "flex",
                gap: 1.25,
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
                scrollSnapType: "x mandatory",
                scrollPaddingLeft: 16,
                scrollPaddingRight: 16,
                WebkitOverflowScrolling: "touch",
              }}
            >
              {destaques.map(({ item, categoria }) => {
                const categoriaType = inferCategoriaType(categoria, item);
                const precoLabel = getPrecoLabel(item, categoria, categoriaType);
                const cardWidth = isMobile ? "calc(100% - 64px)" : 320;

                return (
                  <Paper
                    key={String(item._id)}
                    data-destaque-card="1"
                    onClick={() => abrirModalProduto(item, categoria)}
                    elevation={0}
                    sx={{
                      scrollSnapAlign: "center",
                      scrollSnapStop: "always",
                      flexShrink: 0,
                      width: cardWidth,
                      borderRadius: 2.5,
                      overflow: "hidden",
                      border: "1px solid rgba(0,0,0,0.06)",
                      bgcolor: "#fff",
                      cursor: "pointer",
                      transition: "transform 120ms ease, box-shadow 120ms ease",
                      "&:hover": {
                        transform: "translateY(-1px)",
                        boxShadow: "0 10px 25px rgba(2,6,23,0.06)",
                      },
                      ...(lojaAberta ? {} : { opacity: 0.72, cursor: "not-allowed" }),
                    }}
                  >
                    <Box sx={{ display: "flex", gap: 1.25, p: 1.25 }}>
                      <Avatar
                        src={item.imagem || DEFAULT_IMAGE_URL}
                        alt={item.nome}
                        variant="rounded"
                        sx={{
                          width: 72,
                          height: 72,
                          borderRadius: 2,
                          bgcolor: "#fff",
                          flexShrink: 0,
                        }}
                      />

                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          fontWeight={1000}
                          sx={{
                            fontSize: "0.95rem",
                            lineHeight: 1.2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.nome}
                        </Typography>

                        <Typography
                          variant="caption"
                          sx={{
                            color: "text.secondary",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            mt: 0.3,
                          }}
                        >
                          {item.descricao || categoria?.nome || ""}
                        </Typography>

                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.8 }}>
                          <Typography variant="body2" color="primary" fontWeight={1000}>
                            {precoLabel}
                          </Typography>

                          <Chip
                            size="small"
                            icon={<StarIcon sx={{ color: "#111827 !important" }} fontSize="small" />}
                            label="Destaque"
                            sx={{
                              height: 22,
                              borderRadius: "999px",
                              bgcolor: "rgba(250,204,21,0.22)",
                              fontWeight: 900,
                            }}
                          />
                        </Stack>

                        <Box sx={{ mt: 1 }}>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<AddShoppingCartIcon fontSize="small" />}
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirModalProduto(item, categoria);
                            }}
                            disabled={!lojaAberta}
                            sx={{
                              borderRadius: "999px",
                              textTransform: "none",
                              borderColor: "#ff7a3d55",
                              color: "#ff7a3d",
                              fontWeight: 900,
                              "&:hover": { borderColor: "#ff7a3d", backgroundColor: "#fff7f2" },
                            }}
                          >
                            Adicionar
                          </Button>
                        </Box>
                      </Box>
                    </Box>
                  </Paper>
                );
              })}
            </Box>
          </Box>
        </Box>
      )}

      {/* LISTA */}
      <Container sx={{ py: 2 }} disableGutters>
        {loadingProdutos ? (
          <Box sx={{ px: 2, pt: 1 }}>
            <Paper
              elevation={0}
              sx={{
                p: 2.5,
                mb: 2.5,
                borderRadius: 4,
                bgcolor: "#fff",
                border: "1px solid rgba(15,23,42,0.06)",
                boxShadow: "0 14px 35px rgba(15,23,42,0.06)",
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Avatar sx={{ bgcolor: "#fff3eb", color: "#ff7a3d", width: 52, height: 52 }}>
                  <StorefrontIcon />
                </Avatar>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={1000}>Preparando sua loja</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Estamos organizando cardápio, categorias e valores.
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {[1, 2, 3].map((s) => (
              <Box key={s} sx={{ mb: 3 }}>
                <Skeleton variant="text" width={170} height={30} sx={{ mb: 1 }} />
                {[1, 2].map((i) => (
                  <Paper key={i} elevation={0} sx={{ p: 1.5, mb: 1.2, borderRadius: 3, bgcolor: "#fff" }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Box sx={{ flex: 1 }}>
                        <Skeleton variant="text" width="70%" height={24} />
                        <Skeleton variant="text" width="95%" height={18} />
                        <Skeleton variant="text" width={90} height={24} />
                      </Box>
                      <Skeleton variant="rounded" width={88} height={88} sx={{ borderRadius: 2 }} />
                    </Stack>
                  </Paper>
                ))}
              </Box>
            ))}
          </Box>
        ) : produtos.length === 0 ? (
          <Box sx={{ textAlign: "center", mt: 6, color: "text.secondary", px: 2 }}>
            <Typography variant="subtitle1" fontWeight={900}>
              Nenhum item encontrado
            </Typography>
            <Typography variant="body2">
              {busca
                ? "Tente buscar por outro nome (ex: “pizza”, “coca”, “promoção”)."
                : "Volte mais tarde, o cardápio pode estar em atualização."}
            </Typography>

            {busca && (
              <Button onClick={() => setBusca("")} sx={{ mt: 2, borderRadius: "999px" }} variant="contained">
                Limpar busca
              </Button>
            )}
          </Box>
        ) : (
          produtos.map((categoria, i) => (
            <Box key={categoria._id || i} ref={(el) => (sectionRefs.current[i] = el)} sx={{ mb: 3.5 }}>
              <Box sx={{ px: 2, pt: 1 }}>
                <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                  <Typography variant="h6" fontWeight={900} sx={{ mb: 0.5, color: "#333" }}>
                    {categoria.nome}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                    {(categoria.itens || []).length} item(s)
                  </Typography>
                </Stack>

                {categoria.descricao && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {categoria.descricao}
                  </Typography>
                )}
              </Box>

              <Divider sx={{ mb: 1 }} />

              {categoria.itens.map((item, index) => {
                const categoriaType = inferCategoriaType(categoria, item);

                const isDestaque =
                  item?.destaque === true ||
                  item?.destaque === "true" ||
                  item?.destaque === 1 ||
                  item?.destaque === "1";

                return (
                  <Box key={item._id || index} sx={{ mb: 1 }}>
                    <Fade in timeout={220}>
                      <Paper
                        elevation={0}
                        onClick={() => abrirModalProduto(item, categoria)}
                        aria-disabled={!lojaAberta}
                        sx={{
                          display: "flex",
                          alignItems: "stretch",
                          justifyContent: "space-between",
                          p: 2,
                          cursor: "pointer",
                          borderRadius: 0,
                          bgcolor: "white",
                          borderBottom: "1px solid #eeeeee",
                          boxShadow: "none",
                          transition: "transform 120ms ease, background-color 120ms ease",
                          "&:hover": { backgroundColor: "#fafafa", transform: "translateY(-1px)" },
                          ...(lojaAberta ? {} : { opacity: 0.72, cursor: "not-allowed" }),
                        }}
                      >
                        <Box sx={{ flex: 1, pr: 1 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="subtitle1" fontWeight={900} sx={{ mb: 0.25, lineHeight: 1.15 }}>
                              {item.nome}
                            </Typography>

                            {item.tag && (
                              <Chip label={item.tag} size="small" color="secondary" variant="outlined" sx={{ height: 22 }} />
                            )}

                            {isDestaque && (
                              <Chip
                                icon={<StarIcon fontSize="small" />}
                                label="Destaque"
                                size="small"
                                variant="outlined"
                                sx={{ height: 22, fontWeight: 900 }}
                              />
                            )}
                          </Stack>

                          {item.descricao && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                mb: 1,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {item.descricao}
                            </Typography>
                          )}

                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }}>
                            <Typography variant="body2" color="primary" fontWeight={900}>
                              {getPrecoLabel(item, categoria, categoriaType)}
                            </Typography>

                            {(item.adicionais?.length ||
                              item.complementos?.length ||
                              item.tiposExtras?.length ||
                              item.sabores?.length ||
                              item.bordas?.length) && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                                • Personalizável
                              </Typography>
                            )}
                          </Stack>

                          <Box sx={{ mt: 1 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<AddShoppingCartIcon fontSize="small" />}
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirModalProduto(item, categoria);
                              }}
                              disabled={!lojaAberta}
                              sx={{
                                borderRadius: "999px",
                                textTransform: "none",
                                borderColor: "#ff7a3d55",
                                color: "#ff7a3d",
                                fontWeight: 900,
                                "&:hover": { borderColor: "#ff7a3d", backgroundColor: "#fff7f2" },
                              }}
                            >
                              Adicionar
                            </Button>
                          </Box>
                        </Box>

                        <Box sx={{ width: 92, height: 92, ml: 1.5, position: "relative", flexShrink: 0 }}>
                          <Avatar
                            src={item.imagem || DEFAULT_IMAGE_URL}
                            alt={item.nome}
                            variant="rounded"
                            sx={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              borderRadius: 2,
                              bgcolor: "#fff",
                            }}
                          />

                          {!lojaAberta && (
                            <Box
                              sx={{
                                position: "absolute",
                                inset: 0,
                                bgcolor: "rgba(0,0,0,0.35)",
                                borderRadius: 2,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Typography variant="caption" sx={{ color: "#fff", fontWeight: 900 }}>
                                Fechado
                              </Typography>
                            </Box>
                          )}
                        </Box>
                      </Paper>
                    </Fade>
                  </Box>
                );
              })}
            </Box>
          ))
        )}
      </Container>

      {/* Modal */}
      {produtoSelecionado && (
        <ModalProduto
          open={modalAberto}
          onClose={() => {
            setModalAberto(false);
            setDestaqueCountdown(10);
          }}
          produto={produtoSelecionado}
        />
      )}

      {/* Bottom nav */}
      <Paper elevation={10} sx={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000 }}>
        <BottomNavigation showLabels>
          <BottomNavigationAction label="Início" icon={<HomeIcon />} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
          <BottomNavigationAction label="Pedidos" icon={<ListAltIcon />} onClick={() => { const tel = localStorage.getItem("telefoneCliente") || ""; navigate(tel ? `/p/meus-pedidos/${tel}` : "/p/meus-pedidos"); }} />
          <BottomNavigationAction
            label="Carrinho"
            icon={
              <Badge badgeContent={quantidadeCarrinho} color="error">
                <ShoppingCartIcon />
              </Badge>
            }
            onClick={() => navigate("/p/carrinho")}
          />
        </BottomNavigation>
      </Paper>

      {/* Aviso loja fechada */}
      <Snackbar
        open={avisoFechadoOpen}
        autoHideDuration={4000}
        onClose={() => setAvisoFechadoOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setAvisoFechadoOpen(false)}
          severity="warning"
          variant="filled"
          sx={{ width: "100%" }}
        >
          {avisoMensagem || "Restaurante fechado no momento."}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Publico;
