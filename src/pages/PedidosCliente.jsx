import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Typography,
  Container,
  Paper,
  Divider,
  CircularProgress,
  AppBar,
  Toolbar,
  Chip,
  Button,
  Stack,
  TextField,
  Avatar,
  Alert,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
} from "@mui/material";
import {
  CheckCircleOutline,
  CancelOutlined,
  LocalShipping,
  AccessTime,
  HourglassBottom,
  ArrowBack,
  ReceiptLong,
  Search,
  Storefront,
  Edit,
  PhoneIphone,
  ShoppingBag,
  Pix as PixIcon,
  ContentCopy,
  QrCode2,
} from "@mui/icons-material";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Helmet } from "react-helmet";

import { API_BASE_URL } from "../config";

const API_URL = API_BASE_URL;
const GLOBAL_PHONE_KEY = "telefoneCliente";
const PIX_TTL_MS = 15 * 60 * 1000;

function parseValor(valor) {
  if (valor == null || valor === "") return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === "string") {
    const clean = valor.replace(/[^\d,.-]/g, "");
    const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatBRL(valor) {
  return parseValor(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatTelefone(value) {
  const d = onlyDigits(value);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

function getRestauranteAtual() {
  try {
    const raw = JSON.parse(localStorage.getItem("restauranteSelecionado") || "null");
    return raw?.restaurante || raw;
  } catch {
    return null;
  }
}

function phoneKey(restaurante) {
  const id = restaurante?._id || restaurante?.id || restaurante?.slugIdentificador || restaurante?.slug;
  return id ? `telefoneCliente:${id}` : GLOBAL_PHONE_KEY;
}

function getTelefoneSalvo(restaurante) {
  return onlyDigits(localStorage.getItem(phoneKey(restaurante)) || localStorage.getItem(GLOBAL_PHONE_KEY) || "");
}

function saveTelefone(restaurante, telefone) {
  const tel = onlyDigits(telefone);
  localStorage.setItem(GLOBAL_PHONE_KEY, tel);
  localStorage.setItem(phoneKey(restaurante), tel);
  localStorage.setItem("cliente_telefone", tel);
}

function getItemTotal(item) {
  const direto = parseValor(item?.precoTotal ?? item?.valorTotal ?? item?.total);
  if (direto > 0) return direto;
  return parseValor(item?.precoUnitario ?? item?.preco ?? item?.valor ?? item?.precoBase) * Number(item?.quantidade || 1);
}

function getPedidoId(pedido) {
  return pedido?._id || pedido?.id || pedido?.pedidoId || "";
}

function isPix(pedido) {
  return String(pedido?.formaPagamento || pedido?.formadePagamento || "").toLowerCase().includes("pix");
}

function isPago(pedido) {
  const st = String(pedido?.statusPagamento || pedido?.payment_status || "").toLowerCase();
  return ["pago", "paid", "approved", "accredited"].includes(st);
}

function isCancelado(pedido) {
  const st = String(pedido?.status || "").toLowerCase();
  const sp = String(pedido?.statusPagamento || "").toLowerCase();
  return st === "cancelado" || ["cancelado", "cancelled", "canceled", "expirado", "expired"].includes(sp);
}

function getCreatedMs(pedido) {
  const raw = pedido?.criadoEm || pedido?.created_at || pedido?.createdAt || pedido?.dataCriacao;
  const ms = raw ? new Date(raw).getTime() : Date.now();
  return Number.isFinite(ms) ? ms : Date.now();
}

function getPixExpiresAt(pedido) {
  const fromApi = Number(pedido?.pixExpiresAt || 0);
  return fromApi || getCreatedMs(pedido) + PIX_TTL_MS;
}

function getTimeLeftMs(pedido) {
  return Math.max(0, getPixExpiresAt(pedido) - Date.now());
}

function isAguardandoPix(pedido) {
  if (!isPix(pedido) || isPago(pedido) || isCancelado(pedido)) return false;
  const st = String(pedido?.status || "").toLowerCase();
  const sp = String(pedido?.statusPagamento || "").toLowerCase();
  const pendente = ["aguardando_pagamento", "pendente"].includes(st) || ["pending", "pendente", "in_process", "authorized"].includes(sp);
  return pendente && getTimeLeftMs(pedido) > 0;
}

function msToMMSS(ms) {
  const s = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function qrImageSrc(pedido) {
  const raw = String(pedido?.pixQrCodeBase64 || pedido?.qrCodeBase64 || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image") || raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `data:image/png;base64,${raw}`;
}

function pixCopiaCola(pedido) {
  return String(pedido?.pixQrCode || pedido?.pixCopiaECola || pedido?.qrCode || "").trim();
}

function statusInfoPedido(pedido) {
  if (isPago(pedido)) return { label: "Pago", color: "success", icon: <CheckCircleOutline fontSize="small" /> };
  if (isAguardandoPix(pedido)) return { label: "Aguardando pagamento", color: "warning", icon: <HourglassBottom fontSize="small" /> };
  if (isCancelado(pedido)) return { label: "Cancelado", color: "error", icon: <CancelOutlined fontSize="small" /> };

  const rawStatus = String(pedido.status || "").toLowerCase();
  const map = {
    aguardando_pagamento: { label: "Aguardando pagamento", color: "warning", icon: <HourglassBottom fontSize="small" /> },
    pendente: { label: "Pendente", color: "warning", icon: <HourglassBottom fontSize="small" /> },
    recebido: { label: "Recebido", color: "info", icon: <ReceiptLong fontSize="small" /> },
    aceito: { label: "Aceito", color: "info", icon: <ReceiptLong fontSize="small" /> },
    em_preparo: { label: "Em preparo", color: "warning", icon: <AccessTime fontSize="small" /> },
    em_producao: { label: "Em produção", color: "warning", icon: <AccessTime fontSize="small" /> },
    pronto: { label: "Pronto", color: "primary", icon: <CheckCircleOutline fontSize="small" /> },
    saiu_para_entrega: { label: "Saiu para entrega", color: "primary", icon: <LocalShipping fontSize="small" /> },
    em_entrega: { label: "Em entrega", color: "primary", icon: <LocalShipping fontSize="small" /> },
    entregue: { label: "Concluído", color: "success", icon: <CheckCircleOutline fontSize="small" /> },
    concluido: { label: "Concluído", color: "success", icon: <CheckCircleOutline fontSize="small" /> },
  };
  return map[rawStatus] || { label: pedido.status || "Em análise", color: "default", icon: <HourglassBottom fontSize="small" /> };
}

const PedidosCliente = () => {
  const { telefone: telefoneParam } = useParams();
  const navigate = useNavigate();
  const restaurante = getRestauranteAtual();
  const telefoneInicial = onlyDigits(telefoneParam || getTelefoneSalvo(restaurante));

  const [telefoneBusca, setTelefoneBusca] = useState(telefoneInicial);
  const [telefoneAtivo, setTelefoneAtivo] = useState("");
  const [editandoTelefone, setEditandoTelefone] = useState(!telefoneInicial);
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  const [qrPedido, setQrPedido] = useState(null);
  const [cancelandoId, setCancelandoId] = useState("");
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });
  const [, tick] = useState(0);

  const slug = restaurante?.slugIdentificador || restaurante?.slug || "";
  const voltarLoja = () => navigate(slug ? `/${slug}` : "/p");

  const buscarPedidos = async (telefoneDigitado = telefoneBusca) => {
    const tel = onlyDigits(telefoneDigitado);
    if (tel.length < 8) {
      setErro("Informe o telefone usado no pedido.");
      setEditandoTelefone(true);
      return;
    }

    setErro("");
    setLoading(true);
    setTelefoneAtivo(tel);
    setTelefoneBusca(tel);
    setEditandoTelefone(false);
    saveTelefone(restaurante, tel);

    try {
      const res = await axios.get(`${API_URL}/publico/pedidos/${tel}`, {
        params: { restauranteId: restaurante?._id || restaurante?.id },
      });
      const lista = Array.isArray(res.data) ? res.data : res.data?.pedidos || [];
      setPedidos(lista);
    } catch (err) {
      console.error("Erro ao buscar pedidos:", err);
      setPedidos([]);
      setErro("Não foi possível carregar seus pedidos agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const tel = onlyDigits(telefoneParam || getTelefoneSalvo(restaurante));
    if (tel) buscarPedidos(tel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefoneParam]);

  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const cancelarPix = async (pedido) => {
    const id = getPedidoId(pedido);
    if (!id) return;
    setCancelandoId(id);
    try {
      await axios.post(`${API_URL}/publico/pedidos/${id}/cancelar-pix`);
      setSnack({ open: true, msg: "Pix cancelado com sucesso.", severity: "success" });
      if (telefoneAtivo) await buscarPedidos(telefoneAtivo);
    } catch (err) {
      console.error("Erro ao cancelar Pix:", err);
      setSnack({ open: true, msg: err?.response?.data?.message || "Não foi possível cancelar este Pix.", severity: "error" });
    } finally {
      setCancelandoId("");
    }
  };

  const copiarPix = async () => {
    const codigo = pixCopiaCola(qrPedido);
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setSnack({ open: true, msg: "Código Pix copiado.", severity: "success" });
    } catch {
      setSnack({ open: true, msg: "Não foi possível copiar o código.", severity: "error" });
    }
  };

  const { ativos, historico } = useMemo(() => {
    const ativos = [];
    const historico = [];
    for (const p of pedidos) {
      const status = String(p.status || "").toLowerCase();
      if (isAguardandoPix(p) || !["entregue", "cancelado", "concluido"].includes(status)) ativos.push(p);
      else historico.push(p);
    }
    return { ativos, historico };
  }, [pedidos]);

  const renderDetalhesItem = (item) => (
    <Stack spacing={0.25} sx={{ mt: 0.5 }}>
      {item.saboresSelecionados?.length > 0 && <Typography variant="caption" color="text.secondary">Sabores: {item.saboresSelecionados.join(" / ")}</Typography>}
      {item.bordaSelecionada?.nome && <Typography variant="caption" color="text.secondary">Borda: {item.bordaSelecionada.nome} (+{formatBRL(item.bordaSelecionada.preco)})</Typography>}
      {item.adicionalSelecionado?.nome && <Typography variant="caption" color="text.secondary">Adicional: {item.adicionalSelecionado.nome} (+{formatBRL(item.adicionalSelecionado.preco)})</Typography>}
      {item.complementosSelecionados?.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Complementos: {item.complementosSelecionados.map((c) => `${c.nome} (+${formatBRL(c.preco)})`).join(", ")}
        </Typography>
      )}
      {item.observacao && <Typography variant="caption" color="text.secondary">Obs.: {item.observacao}</Typography>}
    </Stack>
  );

  const renderPedido = (pedido) => {
    const info = statusInfoPedido(pedido);
    const total = parseValor(pedido.valorTotal ?? pedido.total ?? pedido.valor);
    const criadoEm = pedido.criadoEm || pedido.created_at || pedido.createdAt || pedido.dataCriacao;
    const aguardandoPix = isAguardandoPix(pedido);
    const pago = isPago(pedido);
    const cancelado = isCancelado(pedido);
    const id = getPedidoId(pedido);
    const temQr = Boolean(pixCopiaCola(pedido) || qrImageSrc(pedido));

    return (
      <Paper key={id || pedido.numeroPedido} elevation={0} sx={{ mb: 2, p: 2, borderRadius: 4, bgcolor: "#fff", border: aguardandoPix ? "2px solid rgba(255,122,61,0.45)" : "1px solid rgba(255,122,61,0.16)", boxShadow: aguardandoPix ? "0 18px 44px rgba(255,122,61,0.18)" : "0 14px 34px rgba(15,23,42,0.07)" }}>
        {aguardandoPix && (
          <Alert severity="warning" icon={<PixIcon />} sx={{ mb: 1.5, borderRadius: 3 }}>
            <Stack spacing={0.3}>
              <Typography fontWeight={1000}>Aguardando pagamento Pix</Typography>
              <Typography variant="body2">Pague em até <strong>{msToMMSS(getTimeLeftMs(pedido))}</strong> para confirmar seu pedido.</Typography>
            </Stack>
          </Alert>
        )}

        {pago && (
          <Alert severity="success" sx={{ mb: 1.5, borderRadius: 3 }}>
            Pagamento confirmado. Seu pedido já foi enviado para o restaurante.
          </Alert>
        )}

        {cancelado && (
          <Alert severity="error" sx={{ mb: 1.5, borderRadius: 3 }}>
            Pedido cancelado. Se era Pix e não foi pago dentro do prazo, ele expirou automaticamente.
          </Alert>
        )}

        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={1000} noWrap>Pedido #{pedido.numeroPedido || String(id).slice(-6)}</Typography>
            <Typography variant="body2" color="text.secondary">{criadoEm ? new Date(criadoEm).toLocaleString("pt-BR") : "Data indisponível"}</Typography>
          </Box>
          <Chip icon={info.icon} label={info.label} color={info.color} sx={{ fontWeight: 900, borderRadius: 999 }} />
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={1.2}>
          {(pedido.itens || []).filter((item) => String(item?.nome || "").toLowerCase() !== "entrega").map((item, i) => (
            <Box key={i}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Typography variant="body2" fontWeight={900} sx={{ flex: 1 }}>{Number(item.quantidade || 1)}x {item.nome}</Typography>
                <Typography variant="body2" fontWeight={1000} sx={{ color: "#0f3a5f" }}>{formatBRL(getItemTotal(item))}</Typography>
              </Stack>
              {renderDetalhesItem(item)}
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" color="text.secondary" fontWeight={800}>Total do pedido</Typography>
          <Typography variant="h6" sx={{ color: "#0f3a5f" }} fontWeight={1000}>{formatBRL(total)}</Typography>
        </Stack>

        {aguardandoPix && (
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1.5 }}>
            <Button fullWidth variant="contained" startIcon={<QrCode2 />} disabled={!temQr} onClick={() => setQrPedido(pedido)} sx={{ borderRadius: 999, fontWeight: 1000, textTransform: "none", background: "linear-gradient(90deg,#ff4b8b,#ff7a3d)" }}>
              Rever QR Code
            </Button>
            <Button fullWidth variant="outlined" color="error" disabled={cancelandoId === id} onClick={() => cancelarPix(pedido)} sx={{ borderRadius: 999, fontWeight: 1000, textTransform: "none" }}>
              {cancelandoId === id ? "Cancelando..." : "Cancelar pedido"}
            </Button>
          </Stack>
        )}
      </Paper>
    );
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f5f5f7", pb: 4 }}>
      <Helmet>
        <title>{restaurante?.nome ? `${restaurante.nome} - Meus pedidos` : "Meus pedidos - Movyo"}</title>
      </Helmet>

      <AppBar position="sticky" elevation={0} sx={{ background: "linear-gradient(90deg, #ff4b8b 0%, #ff7a3d 48%, #ffb347 100%)" }}>
        <Toolbar sx={{ gap: 1.5 }}>
          <IconButton color="inherit" onClick={voltarLoja} sx={{ borderRadius: 999 }}><ArrowBack /></IconButton>
          <Avatar src={restaurante?.logoUrl || restaurante?.logoSlug || undefined} sx={{ bgcolor: "rgba(255,255,255,.22)", color: "#fff" }}><Storefront /></Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={1000} noWrap>Meus pedidos</Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,.84)" }} noWrap>{restaurante?.nome || "Movyo Vitrine"}</Typography>
          </Box>
        </Toolbar>
      </AppBar>

      <Container sx={{ py: 2.5 }} maxWidth="sm">
        <Paper elevation={0} sx={{ p: 2.2, mb: 2.5, borderRadius: 5, background: "linear-gradient(180deg,#ffffff 0%,#fff8f3 100%)", border: "1px solid rgba(255,122,61,0.16)", boxShadow: "0 14px 36px rgba(255,122,61,0.10)" }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
            <Avatar sx={{ background: "linear-gradient(135deg,#ff4b8b,#ff7a3d)", color: "#fff" }}><PhoneIphone /></Avatar>
            <Box sx={{ flex: 1 }}>
              <Typography fontWeight={1000}>Acompanhe seus pedidos</Typography>
              <Typography variant="body2" color="text.secondary">Seu telefone fica salvo para as próximas consultas.</Typography>
            </Box>
          </Stack>

          {!editandoTelefone && telefoneAtivo ? (
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ p: 1.25, borderRadius: 3, bgcolor: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
              <Box>
                <Typography variant="caption" color="text.secondary" fontWeight={800}>Consultando pelo telefone</Typography>
                <Typography fontWeight={1000}>{formatTelefone(telefoneAtivo)}</Typography>
              </Box>
              <Button startIcon={<Edit />} onClick={() => setEditandoTelefone(true)} sx={{ borderRadius: 999, fontWeight: 900 }}>Alterar</Button>
            </Stack>
          ) : (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField value={formatTelefone(telefoneBusca)} onChange={(e) => setTelefoneBusca(onlyDigits(e.target.value).slice(0, 11))} onKeyDown={(e) => { if (e.key === "Enter") buscarPedidos(); }} label="Telefone" placeholder="Ex: (81) 99999-9999" fullWidth size="small" />
              <Button variant="contained" startIcon={loading ? <CircularProgress color="inherit" size={18} /> : <Search />} onClick={() => buscarPedidos()} disabled={loading} sx={{ borderRadius: 3, px: 2.5, fontWeight: 1000, background: "linear-gradient(90deg,#ff4b8b,#ff7a3d)" }}>Buscar</Button>
            </Stack>
          )}

          {erro && <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 3 }}>{erro}</Alert>}
        </Paper>

        {loading ? (
          <Stack alignItems="center" sx={{ py: 6 }} spacing={1.5}>
            <CircularProgress sx={{ color: "#ff7a3d" }} />
            <Typography variant="body2" color="text.secondary">Carregando seus pedidos...</Typography>
          </Stack>
        ) : telefoneAtivo && pedidos.length === 0 ? (
          <Paper elevation={0} sx={{ p: 3, borderRadius: 5, textAlign: "center", border: "1px solid rgba(15,23,42,0.08)", bgcolor: "#fff" }}>
            <ShoppingBag sx={{ fontSize: 50, color: "#ff7a3d", mb: 1 }} />
            <Typography fontWeight={1000}>Nenhum pedido encontrado</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>Confira se o telefone é o mesmo usado na compra.</Typography>
            <Button variant="outlined" sx={{ mt: 2, borderRadius: 999, fontWeight: 900 }} onClick={() => setEditandoTelefone(true)}>Alterar telefone</Button>
          </Paper>
        ) : (
          <>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.2 }}>
              <Typography variant="h6" fontWeight={1000}>Pedidos ativos</Typography>
              <Chip label={ativos.length} size="small" sx={{ fontWeight: 900 }} />
            </Stack>

            {ativos.length === 0 ? <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Nenhum pedido ativo no momento.</Typography> : ativos.map(renderPedido)}

            <Divider sx={{ my: 3 }} />

            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.2 }}>
              <Typography variant="h6" fontWeight={1000}>Histórico</Typography>
              <Chip label={historico.length} size="small" sx={{ fontWeight: 900 }} />
            </Stack>

            {historico.length === 0 ? <Typography variant="body2" color="text.secondary">Nenhum pedido finalizado ainda.</Typography> : historico.map(renderPedido)}
          </>
        )}

        <Button fullWidth variant="contained" sx={{ mt: 3, py: 1.4, borderRadius: 999, fontWeight: 1000, background: "linear-gradient(90deg,#ff4b8b,#ff7a3d)" }} onClick={voltarLoja}>Fazer novo pedido</Button>
      </Container>

      <Dialog open={Boolean(qrPedido)} onClose={() => setQrPedido(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <PixIcon />
            <Typography fontWeight={1000}>Pagamento Pix</Typography>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {qrPedido && (
            <Stack spacing={1.5}>
              <Alert severity="warning" sx={{ borderRadius: 3 }}>
                Aguardando pagamento. Tempo restante: <strong>{msToMMSS(getTimeLeftMs(qrPedido))}</strong>
              </Alert>
              {qrImageSrc(qrPedido) && (
                <Box sx={{ display: "flex", justifyContent: "center" }}>
                  <img src={qrImageSrc(qrPedido)} alt="QR Code Pix" style={{ width: 260, maxWidth: "100%", borderRadius: 14, border: "1px solid #eee" }} />
                </Box>
              )}
              <Typography variant="subtitle2" fontWeight={1000}>Copia e cola</Typography>
              <Paper variant="outlined" sx={{ p: 1.2, borderRadius: 3, bgcolor: "#fafafa", wordBreak: "break-all" }}>
                <Typography variant="body2">{pixCopiaCola(qrPedido) || "Código Pix indisponível para este pedido."}</Typography>
              </Paper>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrPedido(null)}>Fechar</Button>
          <Button variant="contained" startIcon={<ContentCopy />} onClick={copiarPix} sx={{ borderRadius: 999, fontWeight: 1000, background: "linear-gradient(90deg,#ff4b8b,#ff7a3d)" }}>Copiar código</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack((s) => ({ ...s, open: false }))}>
        <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} sx={{ borderRadius: 3 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default PedidosCliente;
