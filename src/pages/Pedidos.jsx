import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import dayjs from "dayjs";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  Stack,
  Divider,
  MenuItem,
  Select,
  FormControl,
  Paper,
  TextField,
  InputAdornment,
  Tooltip,
  Grid,
  Button,
  IconButton,
  Popover,
} from "@mui/material";

import SearchIcon from "@mui/icons-material/Search";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PlaceIcon from "@mui/icons-material/Place";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import MonetizationOnIcon from "@mui/icons-material/MonetizationOn";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";

const API_BASE = "https://api.movyo.delivery";

const palette = {
  movyo: "#083358",
  bg: "#f3f6fb",
  text: "#0f172a",
  muted: "rgba(15, 23, 42, 0.62)",
  border: "rgba(2,6,23,0.10)",
};

const normalizeStatus = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const mapStatusParaGrupo = (statusRaw) => {
  const s = normalizeStatus(statusRaw);

  if (["pendente", "novo", "em_aberto", "aguardando_pagamento"].includes(s))
    return "pendente";
  if (["aguardando_resposta"].includes(s)) return "aguardando_resposta";
  if (["aceito", "aprovado", "em_producao"].includes(s)) return "aceito";
  if (["em_entrega", "em_rota"].includes(s)) return "em_entrega";
  if (["concluido", "entregue", "finalizado"].includes(s)) return "concluido";

  return "outros";
};

const GROUPS = [
  { key: "pendente", title: "Pendentes", emoji: "📥" },
  { key: "aguardando_resposta", title: "Aguardando", emoji: "🕒" },
  { key: "aceito", title: "Aceitos", emoji: "✅" },
  { key: "em_entrega", title: "Em entrega", emoji: "🛵" },
  { key: "concluido", title: "Concluídos", emoji: "🎉" },
  { key: "outros", title: "Outros", emoji: "🧩" },
];

const statusColor = (groupKey) => {
  switch (groupKey) {
    case "pendente":
      return { fg: "#b45309", bg: "rgba(245, 158, 11, 0.14)" };
    case "aguardando_resposta":
      return { fg: "#0369a1", bg: "rgba(14, 165, 233, 0.14)" };
    case "aceito":
      return { fg: "#1d4ed8", bg: "rgba(59, 130, 246, 0.14)" };
    case "em_entrega":
      return { fg: "#7c2d12", bg: "rgba(251, 146, 60, 0.16)" };
    case "concluido":
      return { fg: "#166534", bg: "rgba(34, 197, 94, 0.14)" };
    default:
      return { fg: "#334155", bg: "rgba(148, 163, 184, 0.20)" };
  }
};

const PedidoCard = ({ pedido, groupKey }) => {
  const c = statusColor(groupKey);
  const total = Number(pedido.valorTotal || 0).toFixed(2);
  const criado = pedido.criadoEm
    ? dayjs(pedido.criadoEm).format("DD/MM HH:mm")
    : "--/-- --:--";

  const endereco = [
    pedido.enderecoCliente,
    pedido.residenciaNumero,
    pedido.residenciaBairro ? `- ${pedido.residenciaBairro}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
  const preview = itens.slice(0, 3);
  const more = Math.max(0, itens.length - preview.length);

  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 2,
        border: `1px solid ${palette.border}`,
        background: "#fff",
        boxShadow: "0 6px 18px rgba(2, 6, 23, 0.06)",
      }}
    >
      <CardContent sx={{ p: 1.3, "&:last-child": { pb: 1.3 } }}>
        <Typography
          sx={{
            fontWeight: 950,
            fontSize: "0.92rem",
            color: palette.text,
          }}
        >
          {pedido.nomeCliente || "—"}
        </Typography>

        <Stack
          direction="row"
          alignItems="center"
          gap={0.8}
          sx={{ mt: 0.7, flexWrap: "wrap" }}
        >
          <Chip
            size="small"
            label={String(pedido.status || "status")}
            sx={{
              height: 20,
              fontSize: "0.7rem",
              bgcolor: c.bg,
              color: c.fg,
              borderRadius: 999,
              fontWeight: 900,
            }}
          />

          <Stack direction="row" alignItems="center" gap={0.4}>
            <AccessTimeIcon sx={{ fontSize: 16, color: "rgba(2,6,23,0.45)" }} />
            <Typography
              sx={{ fontSize: "0.75rem", color: "rgba(2,6,23,0.62)" }}
            >
              {criado}
            </Typography>
          </Stack>

          <Stack direction="row" alignItems="center" gap={0.4}>
            <MonetizationOnIcon
              sx={{ fontSize: 16, color: "rgba(2,6,23,0.45)" }}
            />
            <Typography
              sx={{
                fontSize: "0.8rem",
                fontWeight: 950,
                color: palette.text,
              }}
            >
              R$ {total}
            </Typography>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1 }} />

        <Stack direction="row" alignItems="flex-start" gap={0.8}>
          <PlaceIcon sx={{ fontSize: 18, color: "rgba(2,6,23,0.45)", mt: "2px" }} />
          <Tooltip title={endereco || ""} placement="top">
            <Typography
              sx={{
                fontSize: "0.78rem",
                color: "rgba(2,6,23,0.72)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {endereco || "Endereço não informado"}
            </Typography>
          </Tooltip>
        </Stack>

        {pedido.entregador && (
          <Stack direction="row" alignItems="center" gap={0.8} sx={{ mt: 0.8 }}>
            <LocalShippingIcon
              sx={{ fontSize: 18, color: "rgba(2,6,23,0.45)" }}
            />
            <Typography sx={{ fontSize: "0.78rem", color: "rgba(2,6,23,0.7)" }}>
              {pedido.entregador?.nome || "Entregador"}
            </Typography>
          </Stack>
        )}

        <Divider sx={{ my: 1 }} />

        <Box>
          {preview.map((item, idx) => (
            <Typography
              key={idx}
              sx={{ fontSize: "0.78rem", color: "rgba(2,6,23,0.72)" }}
            >
              {item.quantidade}x {item.nome}
            </Typography>
          ))}
          {more > 0 && (
            <Typography
              sx={{ mt: 0.35, fontSize: "0.74rem", color: "rgba(2,6,23,0.55)" }}
            >
              +{more} item(ns)
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

const Column = ({ group, pedidos, columnHeight }) => {
  const c = statusColor(group.key);

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3,
        border: `1px solid ${palette.border}`,
        background: "#fff",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 10px 28px rgba(2, 6, 23, 0.06)",
        height: columnHeight,
        minHeight: 420,
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.05,
          background: c.bg,
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography sx={{ fontWeight: 950, color: c.fg, fontSize: "0.92rem" }}>
            {group.emoji} {group.title}
          </Typography>
          <Chip
            size="small"
            label={pedidos.length}
            sx={{
              height: 20,
              fontSize: "0.75rem",
              bgcolor: "#fff",
              color: c.fg,
              borderRadius: 999,
              border: `1px solid ${palette.border}`,
              fontWeight: 950,
            }}
          />
        </Stack>
      </Box>

      <Box
        sx={{
          p: 1.2,
          overflowY: "auto",
          flex: 1,
          minHeight: 0,
          "&::-webkit-scrollbar": { width: 6 },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: "rgba(148,163,184,0.85)",
            borderRadius: 999,
          },
          scrollbarWidth: "thin",
        }}
      >
        <Stack spacing={1.1}>
          {pedidos.length === 0 ? (
            <Typography sx={{ fontSize: "0.82rem", color: palette.muted }}>
              Sem pedidos aqui.
            </Typography>
          ) : (
            pedidos.map((p) => (
              <PedidoCard key={p._id} pedido={p} groupKey={group.key} />
            ))
          )}
        </Stack>
      </Box>
    </Paper>
  );
};

export default function DashboardPedidos() {
  const [pedidos, setPedidos] = useState([]);
  const [entregadores, setEntregadores] = useState([]);
  const [loading, setLoading] = useState(false);

  const [filtros, setFiltros] = useState({
    status: "todos",
    entregador: "todos",
    periodo: "todos",
    busca: "",
  });

  const restauranteId = localStorage.getItem("_id");

  const [anchorFiltros, setAnchorFiltros] = useState(null);
  const openFiltros = Boolean(anchorFiltros);

  const fetchPedidos = async () => {
    if (!restauranteId) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/pedidos/${restauranteId}`);
      const lista = Array.isArray(res.data) ? res.data : res.data?.pedidos || [];
      setPedidos(lista);
    } catch (e) {
      console.error("Erro ao buscar pedidos:", e?.response?.data || e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchEntregadores = async () => {
    if (!restauranteId) return;
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(
        `${API_BASE}/api/byRestaurante/${restauranteId}`,
        { headers: { authorization: token } }
      );
      const lista = Array.isArray(res.data) ? res.data : res.data?.entregadores || [];
      setEntregadores(lista);
    } catch (e) {
      console.error("Erro ao buscar entregadores:", e?.response?.data || e.message);
    }
  };

  useEffect(() => {
    fetchPedidos();
    fetchEntregadores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restauranteId]);

  const pedidosFiltrados = useMemo(() => {
    const hoje = dayjs();
    const t = filtros.busca.trim().toLowerCase();

    return pedidos.filter((p) => {
      const grupo = mapStatusParaGrupo(p.status);

      if (filtros.status !== "todos" && grupo !== filtros.status) return false;

      const entregadorId =
        p.entregador?._id || p.entregador || "sem_entregador";
      if (
        filtros.entregador !== "todos" &&
        String(entregadorId) !== String(filtros.entregador)
      )
        return false;

      if (filtros.periodo !== "todos" && p.criadoEm) {
        const criado = dayjs(p.criadoEm);
        if (filtros.periodo === "diario" && !criado.isSame(hoje, "day")) return false;
        if (filtros.periodo === "semanal" && !criado.isAfter(hoje.subtract(7, "day"))) return false;
        if (filtros.periodo === "mensal" && !criado.isAfter(hoje.subtract(30, "day"))) return false;
      }

      if (t) {
        const nome = String(p.nomeCliente || "").toLowerCase();
        const tel = String(p.telefoneCliente || "").toLowerCase();
        const num = String(p.numeroPedido || "").toLowerCase();
        const idc = String(p._id || "").slice(-5).toLowerCase();
        if (!nome.includes(t) && !tel.includes(t) && !num.includes(t) && !idc.includes(t))
          return false;
      }

      return true;
    });
  }, [pedidos, filtros]);

  const grouped = useMemo(() => {
    const obj = {
      pendente: [],
      aguardando_resposta: [],
      aceito: [],
      em_entrega: [],
      concluido: [],
      outros: [],
    };

    for (const p of pedidosFiltrados) obj[mapStatusParaGrupo(p.status)]?.push(p);

    Object.keys(obj).forEach((k) => {
      obj[k].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
    });

    return obj;
  }, [pedidosFiltrados]);

  const counts = useMemo(() => {
    const c = {};
    GROUPS.forEach((g) => (c[g.key] = (grouped[g.key] || []).length));
    return c;
  }, [grouped]);

  const columnHeight = "calc(100vh - 210px)";

  return (
    <Box
      sx={{
        height: "100vh",
        width: "100%",
        background: palette.bg,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* ✅ Header MOVYO (compacto) */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: 4,
            border: `1px solid ${palette.border}`,
            p: 2,
            mb: 2,
            background: "#fff",
            boxShadow: "0 14px 34px rgba(2, 6, 23, 0.08)",
            position: "sticky",
            top: 12,
            zIndex: 10,
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            justifyContent="space-between"
            alignItems={{ md: "center" }}
            gap={1.6}
          >
            {/* esquerda */}
            <Stack direction="row" alignItems="center" gap={1.2} sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 3,
                  background: palette.movyo,
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  fontWeight: 900,
                  flex: "0 0 auto",
                }}
              >
                📦
              </Box>

              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: "1.2rem",
                    fontWeight: 950,
                    color: palette.text,
                    lineHeight: 1.1,
                  }}
                >
                  Painel de Pedidos
                </Typography>
                <Typography sx={{ mt: 0.35, fontSize: "0.88rem", color: palette.muted }}>
                  Total: {pedidosFiltrados.length} pedido(s) no filtro
                  {loading ? " • atualizando..." : ""}
                </Typography>
              </Box>
            </Stack>

            {/* direita: busca + ações */}
            <Stack
              direction={{ xs: "column", sm: "row" }}
              gap={1}
              sx={{ width: { xs: "100%", md: "auto" }, alignItems: { sm: "center" } }}
            >
              <TextField
                size="small"
                placeholder="Buscar cliente, tel, #..."
                value={filtros.busca}
                onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
                sx={{
                  width: { xs: "100%", sm: 320 },
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 999,
                    height: 40,
                    background: "rgba(2,6,23,0.02)",
                  },
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />

              <Stack direction="row" gap={1} sx={{ flexWrap: "wrap" }}>
                <Button
                  variant="outlined"
                  onClick={(e) => setAnchorFiltros(e.currentTarget)}
                  startIcon={<TuneRoundedIcon />}
                  sx={{
                    borderRadius: 999,
                    height: 40,
                    px: 2,
                    textTransform: "none",
                    fontWeight: 900,
                    borderColor: "rgba(2,6,23,0.18)",
                    color: palette.text,
                    background: "rgba(2,6,23,0.02)",
                    "&:hover": { borderColor: "rgba(2,6,23,0.28)", background: "rgba(2,6,23,0.04)" },
                  }}
                >
                  Filtros
                </Button>

                <Button
                  variant="contained"
                  onClick={fetchPedidos}
                  disabled={loading}
                  startIcon={<RefreshRoundedIcon />}
                  sx={{
                    borderRadius: 999,
                    height: 40,
                    px: 2,
                    textTransform: "none",
                    fontWeight: 900,
                    background: palette.movyo,
                    "&:hover": { background: palette.movyo },
                  }}
                >
                  Atualizar
                </Button>
              </Stack>
            </Stack>
          </Stack>

          {/* chips resumo (bem pequenos e “clean”) */}
          <Stack direction="row" gap={1} sx={{ mt: 1.4, flexWrap: "wrap" }}>
            {GROUPS.map((g) => {
              const c = statusColor(g.key);
              return (
                <Chip
                  key={g.key}
                  size="small"
                  label={`${g.emoji} ${g.title}: ${counts[g.key] ?? 0}`}
                  onClick={() => setFiltros((f) => ({ ...f, status: g.key }))}
                  sx={{
                    borderRadius: 999,
                    height: 26,
                    fontWeight: 900,
                    fontSize: "0.72rem",
                    bgcolor: c.bg,
                    color: c.fg,
                    border: `1px solid rgba(2,6,23,0.08)`,
                    cursor: "pointer",
                  }}
                />
              );
            })}
            <Chip
              size="small"
              label="Limpar filtros"
              onClick={() =>
                setFiltros({
                  status: "todos",
                  entregador: "todos",
                  periodo: "todos",
                  busca: "",
                })
              }
              sx={{
                borderRadius: 999,
                height: 26,
                fontWeight: 900,
                fontSize: "0.72rem",
                bgcolor: "rgba(2,6,23,0.04)",
                color: palette.text,
                border: `1px solid rgba(2,6,23,0.10)`,
                cursor: "pointer",
              }}
            />
          </Stack>
        </Paper>

        {/* ✅ Popover dos filtros (limpo) */}
        <Popover
          open={openFiltros}
          anchorEl={anchorFiltros}
          onClose={() => setAnchorFiltros(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          PaperProps={{
            sx: {
              mt: 1,
              borderRadius: 3,
              border: `1px solid ${palette.border}`,
              boxShadow: "0 18px 44px rgba(2, 6, 23, 0.16)",
              width: 320,
              overflow: "hidden",
            },
          }}
        >
          <Box sx={{ p: 1.4, background: "rgba(2,6,23,0.02)" }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontWeight: 950, color: palette.text }}>
                Filtros
              </Typography>
              <IconButton size="small" onClick={() => setAnchorFiltros(null)}>
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Box>

          <Box sx={{ p: 1.4 }}>
            <Stack spacing={1.2}>
              <FormControl size="small" fullWidth>
                <Typography sx={{ fontSize: "0.75rem", color: palette.muted, mb: 0.4, fontWeight: 800 }}>
                  Status
                </Typography>
                <Select
                  value={filtros.status}
                  onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}
                  sx={{ borderRadius: 2.2, background: "#fff" }}
                >
                  <MenuItem value="todos">Todos</MenuItem>
                  {GROUPS.map((g) => (
                    <MenuItem key={g.key} value={g.key}>
                      {g.emoji} {g.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <Typography sx={{ fontSize: "0.75rem", color: palette.muted, mb: 0.4, fontWeight: 800 }}>
                  Período
                </Typography>
                <Select
                  value={filtros.periodo}
                  onChange={(e) => setFiltros({ ...filtros, periodo: e.target.value })}
                  sx={{ borderRadius: 2.2, background: "#fff" }}
                >
                  <MenuItem value="todos">Todos</MenuItem>
                  <MenuItem value="diario">Diário</MenuItem>
                  <MenuItem value="semanal">Semanal</MenuItem>
                  <MenuItem value="mensal">Mensal</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <Typography sx={{ fontSize: "0.75rem", color: palette.muted, mb: 0.4, fontWeight: 800 }}>
                  Entregador
                </Typography>
                <Select
                  value={filtros.entregador}
                  onChange={(e) => setFiltros({ ...filtros, entregador: e.target.value })}
                  sx={{ borderRadius: 2.2, background: "#fff" }}
                >
                  <MenuItem value="todos">Todos</MenuItem>
                  {entregadores.map((ent) => (
                    <MenuItem key={ent._id} value={ent._id}>
                      {ent.nome}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack direction="row" gap={1} sx={{ pt: 0.5 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={() =>
                    setFiltros((f) => ({
                      ...f,
                      status: "todos",
                      entregador: "todos",
                      periodo: "todos",
                    }))
                  }
                  sx={{ borderRadius: 2.2, textTransform: "none", fontWeight: 900 }}
                >
                  Limpar
                </Button>
                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => setAnchorFiltros(null)}
                  sx={{
                    borderRadius: 2.2,
                    textTransform: "none",
                    fontWeight: 900,
                    background: palette.movyo,
                    "&:hover": { background: palette.movyo },
                  }}
                >
                  Aplicar
                </Button>
              </Stack>
            </Stack>
          </Box>
        </Popover>

        {/* ✅ GRID (sem scroll horizontal) */}
        <Grid container spacing={2}>
          {GROUPS.map((g) => (
            <Grid key={g.key} item xs={12} sm={6} lg={4}>
              <Column
                group={g}
                pedidos={grouped[g.key] || []}
                columnHeight={"calc(100vh - 250px)"}
              />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
}
