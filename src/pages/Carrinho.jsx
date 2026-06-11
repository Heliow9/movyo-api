// src/pages/Carrinho.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Paper,
  Button,
  Divider,
  Avatar,
  Stack,
  Chip,
  Snackbar,
  Alert,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ShoppingCartOutlinedIcon from "@mui/icons-material/ShoppingCartOutlined";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { useNavigate, useParams } from "react-router-dom";
import { calcularStatusLoja } from "../utils/horarioLoja";

const DEFAULT_IMAGE_URL =
  "https://cdn-icons-png.flaticon.com/512/1404/1404945.png";

const CART_KEY = "carrinho";
const CART_OWNER_KEY = "carrinho_restaurante_id";
const PIX_PENDENTE_KEY = "pix_pendente";

// ===== helpers =====
function formatBRL(v) {
  const num = Number(v || 0);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getRestauranteFromLS() {
  try {
    const raw = localStorage.getItem("restauranteSelecionado");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.restaurante && typeof parsed.restaurante === "object") return parsed.restaurante;
    return parsed;
  } catch {
    return null;
  }
}

function getCurrentRestaurantId() {
  const r = getRestauranteFromLS();
  return r?._id ? String(r._id) : "";
}

function readCartForCurrentRestaurant() {
  try {
    const currentId = getCurrentRestaurantId();
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

function plural(n, s, p) {
  return n === 1 ? s : p;
}

function normalizeStringsArray(val) {
  if (!val) return [];
  if (typeof val === "string") return val.trim() ? [val.trim()] : [];
  if (Array.isArray(val)) {
    return val
      .map((x) => {
        if (!x) return null;
        if (typeof x === "string") return x.trim();
        if (typeof x === "object") return (x.nome || x.name || "").toString().trim() || null;
        return null;
      })
      .filter(Boolean);
  }
  if (typeof val === "object") {
    if (Array.isArray(val.saboresSelecionados)) return normalizeStringsArray(val.saboresSelecionados);
    if (Array.isArray(val.sabores)) return normalizeStringsArray(val.sabores);
  }
  return [];
}

export default function Carrinho() {
  const navigate = useNavigate();
  const { slug } = useParams();

  const [restaurante, setRestaurante] = useState(() => getRestauranteFromLS());
  const [statusLoja, setStatusLoja] = useState(() =>
    calcularStatusLoja(getRestauranteFromLS())
  );

  const [snack, setSnack] = useState({
    open: false,
    msg: "",
    severity: "info",
  });

  const [itens, setItens] = useState(() => readCartForCurrentRestaurant());

  const slugEfetivo = useMemo(() => {
    const ls = getRestauranteFromLS();
    return slug || ls?.slugIdentificador || ls?.slug || null;
  }, [slug]);

  const irParaCardapio = () => {
    if (slugEfetivo) return navigate(`/p/${slugEfetivo}`);
    return navigate("/");
  };

  // Mantém restaurante/status atualizado
  useEffect(() => {
    const r = getRestauranteFromLS();
    if (r) setRestaurante(r);
    setItens(readCartForCurrentRestaurant());
    setStatusLoja(calcularStatusLoja(r));

    const t = setInterval(() => {
      const rr = getRestauranteFromLS();
      setStatusLoja(calcularStatusLoja(rr));
    }, 30000);

    return () => clearInterval(t);
  }, []);

  // Persistência carrinho
  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(itens || []));
  }, [itens]);

  // ✅ Total (prioriza precoTotal que o Modal já grava pronto)
  const total = useMemo(() => {
    return (itens || []).reduce((acc, item) => {
      const qtd = item.quantidade || 1;

      const sub = Number(item.precoTotal || 0);
      if (sub > 0) return acc + sub;

      const unit = Number(
        item.precoUnitario || item.precoFinal || item.preco || item.total || 0
      );
      return acc + unit * qtd;
    }, 0);
  }, [itens]);

  const alterarQtd = (index, delta) => {
    setItens((prev) => {
      const next = [...(prev || [])];
      const atual = next[index];
      if (!atual) return prev;

      const nova = (atual.quantidade || 1) + delta;

      if (nova <= 0) {
        next.splice(index, 1);
        return next;
      }

      const unit =
        Number(atual.precoTotal || 0) > 0
          ? Number(atual.precoTotal || 0) / (atual.quantidade || 1)
          : Number(atual.precoUnitario || atual.precoFinal || atual.preco || atual.total || 0);

      next[index] = {
        ...atual,
        quantidade: nova,
        ...(Number.isFinite(unit) && unit > 0 ? { precoTotal: unit * nova } : {}),
      };

      return next;
    });
  };

  const removerItem = (index) => {
    setItens((prev) => {
      const next = [...(prev || [])];
      next.splice(index, 1);
      return next;
    });
  };

  const carrinhoVazio = !itens || itens.length === 0;

  const renderAvatar = (size = 34) => {
    if (restaurante?.logoUrl) {
      return (
        <Avatar
          src={restaurante.logoUrl}
          sx={{ width: size, height: size, bgcolor: "#fff" }}
        />
      );
    }
    if (restaurante?.nome) {
      const initials = restaurante.nome
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      return <Avatar sx={{ width: size, height: size }}>{initials || "R"}</Avatar>;
    }
    return (
      <Avatar
        src={DEFAULT_IMAGE_URL}
        sx={{ width: size, height: size, bgcolor: "#fff" }}
      />
    );
  };

  /**
   * ✅ Monta linhas/chips com detalhes do item
   * - sabores: quando for 2 sabores, renderiza em linhas
   */
  const getDetalhes = (item) => {
    const chips = [];

    // ---------- SABORES ----------
    const saboresRaw =
      item?.saboresSelecionados ??
      item?.sabores ??
      item?.pizza?.saboresSelecionados ??
      item?.pizza?.sabores;

    const sabores = normalizeStringsArray(saboresRaw);

    const isPizzaMulti =
      item?.categoriaType === "pizza" ||
      item?.pizzaMultisabor === true ||
      Number(item?.maxSabores || 0) >= 2;

    if (sabores.length) {
      const saboresFinal = isPizzaMulti ? sabores.slice(0, 2) : sabores;

      // ✅ Aqui é o formato que você quer:
      // Sabores:
      // Calabresa
      // 4 Queijos
      chips.push({
        key: "sabores",
        labelNode: (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography sx={{ fontWeight: 900, fontSize: 12, lineHeight: 1.1 }}>
              Sabores:
            </Typography>

            {saboresFinal.map((s, idx) => (
              <Typography
                key={`${s}-${idx}`}
                sx={{ fontWeight: 800, fontSize: 12, lineHeight: 1.1 }}
              >
                {s}
              </Typography>
            ))}
          </Box>
        ),
      });
    }

    // ---------- BORDA ----------
    if (item?.bordaSelecionada?.nome) {
      chips.push({ key: "borda", label: `Borda: ${item.bordaSelecionada.nome}` });
    }

    // ---------- ADICIONAL ----------
    if (item?.adicionalSelecionado?.nome) {
      chips.push({
        key: "adicional",
        label: `Adicional: ${item.adicionalSelecionado.nome}`,
      });
    }

    // ---------- COMPLEMENTOS ----------
    const comps = normalizeStringsArray(item?.complementosSelecionados);
    if (comps.length) {
      chips.push({ key: "comps", label: `Complementos: ${comps.join(", ")}` });
    }

    // ---------- TIPOS EXTRAS ----------
    if (item?.tiposExtrasSelecionados && typeof item.tiposExtrasSelecionados === "object") {
      Object.entries(item.tiposExtrasSelecionados).forEach(([nomeTipo, itensTipo]) => {
        const nomes = normalizeStringsArray(itensTipo).slice(0, 6);
        if (nomes.length) {
          chips.push({
            key: `extra-${nomeTipo}`,
            label: `${nomeTipo}: ${nomes.join(", ")}`,
          });
        }
      });
    }

    return chips;
  };

  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "#f5f5f7", pb: 4 }}>
      {/* TOP BAR */}
      <AppBar
        position="sticky"
        elevation={2}
        sx={{
          background:
            "linear-gradient(90deg, #ff4b8b 0%, #ff7a3d 45%, #ffb347 100%)",
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton edge="start" onClick={irParaCardapio} sx={{ color: "#fff" }}>
            <ArrowBackIcon />
          </IconButton>

          {renderAvatar(34)}

          <Typography
            variant="subtitle1"
            sx={{ color: "#fff", fontWeight: 900, flex: 1, minWidth: 0 }}
            noWrap
          >
            {restaurante?.nome || "Carrinho"}
          </Typography>

          <Chip
            icon={<AccessTimeIcon fontSize="small" />}
            label={statusLoja}
            size="small"
            sx={{
              bgcolor: statusLoja?.toLowerCase?.().includes("aberto")
                ? "#2e7d32"
                : "#c62828",
              color: "#fff",
              fontWeight: 900,
              "& .MuiChip-icon": { color: "#fff" },
              borderRadius: "999px",
            }}
          />
        </Toolbar>
      </AppBar>

      <Box sx={{ px: 2, pt: 2 }}>
        <Typography variant="h6" fontWeight={1000} sx={{ mb: 1 }}>
          Meu Carrinho
        </Typography>

        {/* EMPTY STATE */}
        {carrinhoVazio ? (
          <Paper
            elevation={0}
            sx={{
              mt: 2,
              p: 3,
              borderRadius: 3,
              textAlign: "center",
              bgcolor: "#fff",
              border: "1px solid rgba(0,0,0,0.06)",
            }}
          >
            <Box
              sx={{
                width: 96,
                height: 96,
                borderRadius: "999px",
                bgcolor: "rgba(255,122,61,0.10)",
                display: "grid",
                placeItems: "center",
                mx: "auto",
                mb: 1.5,
              }}
            >
              <ShoppingCartOutlinedIcon sx={{ fontSize: 46, color: "#ff7a3d" }} />
            </Box>

            <Typography fontWeight={1000} sx={{ mb: 0.5 }}>
              Seu carrinho está vazio
            </Typography>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Volte ao cardápio e adicione seus itens favoritos.
            </Typography>

            <Button
              variant="outlined"
              onClick={irParaCardapio}
              sx={{
                borderRadius: "999px",
                textTransform: "none",
                fontWeight: 900,
                px: 3,
                borderColor: "#ff7a3d55",
                color: "#ff7a3d",
                "&:hover": { borderColor: "#ff7a3d", backgroundColor: "#fff7f2" },
              }}
            >
              Ver cardápio
            </Button>
          </Paper>
        ) : (
          <Paper
            elevation={0}
            sx={{
              mt: 2,
              borderRadius: 3,
              overflow: "hidden",
              bgcolor: "#fff",
              border: "1px solid rgba(0,0,0,0.06)",
            }}
          >
            {(itens || []).map((item, index) => {
              const qtd = item.quantidade || 1;

              const sub = Number(item.precoTotal || 0);
              const unitFallback = Number(
                item.precoUnitario || item.precoFinal || item.preco || item.total || 0
              );
              const subtotal = sub > 0 ? sub : unitFallback * qtd;

              const detalhes = getDetalhes(item);

              return (
                <Box key={item._id || index}>
                  <Box sx={{ display: "flex", gap: 1.25, p: 2, alignItems: "flex-start" }}>
                    <Avatar
                      variant="rounded"
                      src={item.imagem || DEFAULT_IMAGE_URL}
                      alt={item.nome}
                      sx={{ width: 62, height: 62, borderRadius: 2, bgcolor: "#fff" }}
                    />

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={1000} noWrap>
                        {item.nome}
                      </Typography>

                      {/* detalhes (chips) */}
                      {detalhes.length > 0 && (
                        <Box
                          sx={{
                            mt: 0.6,
                            display: "flex",
                            gap: 0.6,
                            flexWrap: "wrap",
                            width: "100%",
                          }}
                        >
                          {detalhes.map((d, i) => {
                            const isSabores = d.key === "sabores";
                            return (
                              <Chip
                                key={`${d.key}-${i}`}
                                label={isSabores ? d.labelNode : d.label}
                                size="small"
                                sx={{
                                  borderRadius: "16px",
                                  bgcolor: "rgba(17,24,39,0.06)",
                                  fontWeight: 800,

                                  ...(isSabores
                                    ? {
                                      width: "100%",
                                      height: "auto",
                                      py: 0.6,
                                      alignItems: "flex-start",
                                      "& .MuiChip-label": {
                                        whiteSpace: "normal",
                                        overflow: "visible",
                                        textOverflow: "unset",
                                        display: "block",
                                        px: 1.0,
                                        py: 0.2,
                                      },
                                    }
                                    : {
                                      height: 22,
                                      "& .MuiChip-label": {
                                        whiteSpace: "nowrap",
                                      },
                                    }),
                                }}
                              />
                            );
                          })}
                        </Box>
                      )}

                      {item.observacao && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mt: 0.6 }}
                        >
                          Obs: {item.observacao}
                        </Typography>
                      )}

                      <Typography variant="body2" color="primary" fontWeight={1000} sx={{ mt: 0.8 }}>
                        {formatBRL(subtotal)}
                      </Typography>
                    </Box>

                    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <IconButton size="small" onClick={() => alterarQtd(index, -1)}>
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                        <Typography fontWeight={900} sx={{ minWidth: 18, textAlign: "center" }}>
                          {qtd}
                        </Typography>
                        <IconButton size="small" onClick={() => alterarQtd(index, +1)}>
                          <AddIcon fontSize="small" />
                        </IconButton>
                      </Stack>

                      <IconButton
                        onClick={() => removerItem(index)}
                        aria-label="Remover item"
                        sx={{ mt: -0.25 }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  </Box>

                  {index < itens.length - 1 && <Divider />}
                </Box>
              );
            })}

            <Divider />

            <Box sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={1000}>
                  Total{" "}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ fontWeight: 900 }}>
                    ({itens.length} {plural(itens.length, "item", "itens")})
                  </Typography>
                </Typography>

                <Typography fontWeight={1100} color="primary">
                  {formatBRL(total)}
                </Typography>
              </Stack>

              <Button
                fullWidth
                variant="contained"
                sx={{
                  mt: 2,
                  borderRadius: "999px",
                  textTransform: "none",
                  fontWeight: 1000,
                  bgcolor: "#ff7a3d",
                  "&:hover": { bgcolor: "#ff6b2a" },
                }}
                onClick={() => {
                  if (carrinhoVazio) {
                    setSnack({
                      open: true,
                      msg: "Seu carrinho está vazio.",
                      severity: "warning",
                    });
                    return;
                  }

                  if (!statusLoja?.toLowerCase().includes("aberto")) {
                    setSnack({
                      open: true,
                      msg: "A loja está fechada no momento.",
                      severity: "warning",
                    });
                    return;
                  }

                  navigate(`/p/checkout`);
                }}

              >
                Finalizar pedido
              </Button>

              <Button
                fullWidth
                variant="text"
                sx={{ mt: 1, borderRadius: "999px", textTransform: "none", fontWeight: 900 }}
                onClick={irParaCardapio}
              >
                Continuar comprando
              </Button>
            </Box>
          </Paper>
        )}
      </Box>

      <Snackbar
        open={snack.open}
        autoHideDuration={3500}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          severity={snack.severity || "info"}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
