// src/pages/Motoristas.jsx
import React, { useEffect, useState } from "react";
import {
  Container,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
  Backdrop,
  Stack,
  Box,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import DeleteIcon from "@mui/icons-material/Delete";
import LockResetIcon from "@mui/icons-material/LockReset";

// ícones dos balões
import GroupIcon from "@mui/icons-material/Group";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import WifiIcon from "@mui/icons-material/Wifi";

import axios from "axios";
import { io } from "socket.io-client";

const API_BASE = "https://api.movyo.delivery";
const API_DELETE_BASE = "https://api.movyo.delivery";
const SOCKET_BASE = "https://api.movyo.delivery";

const Motoristas = () => {
  const [motoristas, setMotoristas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modalSenhaAberto, setModalSenhaAberto] = useState(false);
  const [motoristaSelecionado, setMotoristaSelecionado] = useState(null);
  const [novaSenha, setNovaSenha] = useState("");

  const [open, setOpen] = useState(false);
  const [novoMotorista, setNovoMotorista] = useState({
    nome: "",
    email: "",
    senha: "",
    cpf: "",
  });

  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  const [onlineIds, setOnlineIds] = useState([]);

  const restauranteId = localStorage.getItem("_id");
  const token = localStorage.getItem("token");

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  // 🔄 carrega motoristas
  const fetchMotoristas = async () => {
    if (!restauranteId || !token) return;

    try {
      setLoading(true);
      const res = await fetch(
        `${API_BASE}/api/entregadores/byRestaurante/${restauranteId}`,
        {
          headers: { Authorization: token },
        }
      );
      const data = await res.json();
      console.log("📦 Motoristas:", data);
      setMotoristas(data || []);
    } catch (err) {
      console.error("Erro ao buscar entregadores:", err);
      setSnackbar({
        open: true,
        message: `Erro ao carregar entregadores: RestauranteID - ${restauranteId}`,
        severity: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMotoristas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 🔌 socket – quem está online
  useEffect(() => {
    if (!restauranteId) return;

    const socket = io(SOCKET_BASE, {
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      console.log("✅ [Motoristas] Socket conectado:", socket.id);
      socket.emit("joinRestaurante", { restauranteId });
    });

    socket.on("deliverersOnline", (data) => {
      console.log("📡 deliverersOnline (Motoristas):", data);
      if (Array.isArray(data)) {
        const onlyAvailable = data.filter((d) => d.status === true);
        const ids = onlyAvailable.map((d) => d._id).filter(Boolean);
        setOnlineIds(ids);
      }
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Erro socket Motoristas:", err.message);
    });

    return () => {
      console.log("🔌 Desconectando socket Motoristas");
      socket.disconnect();
    };
  }, [restauranteId]);

  const handleCadastrar = async () => {
    const body = { ...novoMotorista, restauranteId };

    try {
      await axios.post(`${API_BASE}/api/entregadores/register`, body, {
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
      });

      setSnackbar({
        open: true,
        message: "Entregador cadastrado com sucesso!",
        severity: "success",
      });
      handleClose();
      setNovoMotorista({ nome: "", email: "", senha: "", cpf: "" });
      fetchMotoristas();
    } catch (err) {
      setSnackbar({
        open: true,
        message: "Erro ao cadastrar entregador. Verifique os dados.",
        severity: "error",
      });
      console.error(
        "Erro ao cadastrar entregador:",
        err.response?.data || err.message
      );
    }
  };

  const handleExcluir = async (id) => {
    try {
      await axios.delete(`${API_DELETE_BASE}/api/entregadordelete/${id}`, {
        headers: { Authorization: token },
      });

      setSnackbar({
        open: true,
        message: "Entregador excluído com sucesso!",
        severity: "success",
      });
      fetchMotoristas();
    } catch (err) {
      setSnackbar({
        open: true,
        message: "Erro ao excluir entregador.",
        severity: "error",
      });
      console.error(
        "Erro ao excluir entregador:",
        err.response?.data || err.message
      );
    }
  };

  const handleTrocarSenha = async () => {
    if (!motoristaSelecionado) return;

    try {
      await axios.put(
        `${API_BASE}/api/entregadores/${motoristaSelecionado._id}/senha`,
        { novaSenha },
        { headers: { Authorization: token } }
      );

      setSnackbar({
        open: true,
        message: "Senha atualizada com sucesso!",
        severity: "success",
      });
      setModalSenhaAberto(false);
      setNovaSenha("");
    } catch (error) {
      console.error("Erro ao trocar senha:", error);
      setSnackbar({
        open: true,
        message: "Erro ao atualizar senha.",
        severity: "error",
      });
    }
  };

  const filteredMotoristas = motoristas
    .filter((m) =>
      [m.nome, m.email].join(" ").toLowerCase().includes(search.toLowerCase())
    )
    .filter((m) => (statusFilter ? m.statusConta === statusFilter : true));

  const abrirModalTrocarSenha = (motorista) => {
    setMotoristaSelecionado(motorista);
    setModalSenhaAberto(true);
  };

  // 📊 contadores
  const totalMotoristas = motoristas.length;
  const ativos = motoristas.filter((m) => m.statusConta === "ativo").length;
  const inativos = motoristas.filter((m) => m.statusConta === "inativo").length;
  const online = motoristas.filter((m) => onlineIds.includes(m._id)).length;

  const getPedidosAtivos = (m) => {
    return (
      m.pedidosAtivos ??
      m.qtdPedidosAtivos ??
      m.pedidosEmAndamento ??
      0
    );
  };

  // 🔧 componentezinho para não repetir estilo dos balões
  const StatCard = ({ icon, label, value, sx }) => (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        p: 1.6,
        borderRadius: 999,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        border: "1px solid rgba(148,163,184,0.35)",
        background:
          "linear-gradient(135deg, rgba(248,250,252,0.96), rgba(241,245,249,0.96))",
        ...sx,
      }}
    >
      <Box
        sx={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(15,23,42,0.04)",
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography
          sx={{
            fontSize: "0.72rem",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "#6b7280",
            mb: 0.3,
          }}
        >
          {label}
        </Typography>
        <Typography sx={{ fontSize: "1.2rem", fontWeight: 800 }}>
          {value}
        </Typography>
      </Box>
    </Paper>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      {/* Cabeçalho */}
      <Box sx={{ mb: 2 }}>
        <Typography
          variant="h5"
          sx={{ fontWeight: 800, color: "#083358", mb: 0.5 }}
        >
          Gerenciar entregadores
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", maxWidth: 480 }}
        >
          Cadastre, filtre e gerencie os entregadores vinculados ao seu
          restaurante.
        </Typography>
      </Box>

      {/* Pills de status */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        sx={{ mb: 3 }}
      >
        <StatCard
          label="Total de entregadores"
          value={totalMotoristas}
          icon={<GroupIcon fontSize="small" sx={{ color: "#0f172a" }} />}
        />

        <StatCard
          label="Ativos"
          value={ativos}
          icon={<CheckCircleIcon fontSize="small" sx={{ color: "#16a34a" }} />}
          sx={{
            borderColor: "rgba(22,163,74,0.35)",
            background:
              "linear-gradient(135deg, rgba(220,252,231,0.9), rgba(240,253,250,0.9))",
          }}
        />

        <StatCard
          label="Inativos"
          value={inativos}
          icon={<HighlightOffIcon fontSize="small" sx={{ color: "#f97316" }} />}
          sx={{
            borderColor: "rgba(148,163,184,0.6)",
            background:
              "linear-gradient(135deg, rgba(248,250,252,0.95), rgba(241,245,249,0.95))",
          }}
        />

        <StatCard
          label="Online no mapa"
          value={online}
          icon={<WifiIcon fontSize="small" sx={{ color: "#2563eb" }} />}
          sx={{
            borderColor: "rgba(59,130,246,0.5)",
            background:
              "linear-gradient(135deg, rgba(219,234,254,0.95), rgba(224,242,254,0.95))",
          }}
        />
      </Stack>

      {/* Card principal */}
      <Paper
        elevation={6}
        sx={{
          borderRadius: 3,
          p: 2.5,
          boxShadow: "0 18px 45px rgba(15,23,42,0.25)",
        }}
      >
        {/* Filtros + botão */}
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <TextField
            label="Buscar por nome ou email"
            variant="outlined"
            fullWidth
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          <FormControl fullWidth size="small">
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              label="Status"
            >
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="ativo">Ativo</MenuItem>
              <MenuItem value="inativo">Inativo</MenuItem>
            </Select>
          </FormControl>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpen}
            sx={{
              minWidth: 180,
              textTransform: "none",
              fontWeight: 700,
              borderRadius: 999,
              backgroundImage:
                "linear-gradient(135deg, #ff3b8a 0%, #ff9b2d 100%)",
              boxShadow:
                "0 12px 30px rgba(255,59,138,0.45), 0 4px 14px rgba(0,0,0,0.24)",
              "&:hover": {
                filter: "brightness(1.05)",
                boxShadow:
                  "0 14px 32px rgba(255,59,138,0.55), 0 5px 16px rgba(0,0,0,0.26)",
              },
            }}
          >
            Novo entregador
          </Button>
        </Stack>

        {/* Tabela */}
        {loading ? (
          <Box
            sx={{
              py: 6,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <CircularProgress />
          </Box>
        ) : (
          <Paper
            elevation={0}
            sx={{
              borderRadius: 2,
              border: "1px solid rgba(148,163,184,0.35)",
              overflow: "hidden",
            }}
          >
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f9fafb" }}>
                  <TableCell sx={{ fontWeight: 600 }}>Nome</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Online</TableCell>
                  <TableCell
                    align="center"
                    sx={{ fontWeight: 600, width: 260 }}
                  >
                    Ações
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredMotoristas.length > 0 ? (
                  filteredMotoristas.map((m) => {
                    const isOnline = onlineIds.includes(m._id);
                    const pedidosAtivos = getPedidosAtivos(m);
                    const muitosPedidos = pedidosAtivos >= 3;

                    return (
                      <TableRow key={m._id} hover>
                        <TableCell>{m.nome}</TableCell>
                        <TableCell>{m.email}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              label={
                                m.statusConta === "ativo" ? "Ativo" : "Inativo"
                              }
                              color={
                                m.statusConta === "ativo"
                                  ? "success"
                                  : "default"
                              }
                              variant="outlined"
                              size="small"
                            />
                            {muitosPedidos && (
                              <Chip
                                label={`${pedidosAtivos} em andamento`}
                                size="small"
                                color="warning"
                                variant="filled"
                              />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            <Box
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                backgroundColor: isOnline
                                  ? "#22c55e"
                                  : "#9ca3af",
                              }}
                            />
                            <Typography
                              sx={{
                                fontSize: "0.75rem",
                                color: isOnline ? "#16a34a" : "#6b7280",
                              }}
                            >
                              {isOnline ? "Online" : "Offline"}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="center">
                          <Stack
                            direction="row"
                            spacing={1}
                            justifyContent="center"
                            sx={{ "& button": { textTransform: "none" } }}
                          >
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              startIcon={<DeleteIcon fontSize="small" />}
                              onClick={() => handleExcluir(m._id)}
                            >
                              Excluir
                            </Button>
                            <Button
                              size="small"
                              color="primary"
                              variant="outlined"
                              startIcon={<LockResetIcon fontSize="small" />}
                              onClick={() => abrirModalTrocarSenha(m)}
                            >
                              Trocar senha
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                      <Typography
                        variant="body1"
                        sx={{ color: "text.secondary", mb: 1 }}
                      >
                        Nenhum entregador encontrado.
                      </Typography>
                      <Button
                        variant="text"
                        onClick={handleOpen}
                        sx={{ textTransform: "none", fontWeight: 600 }}
                      >
                        Cadastrar primeiro entregador
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Paper>

      {/* Modal Cadastro */}
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <DialogTitle>Cadastrar novo entregador</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            margin="dense"
            label="Nome"
            value={novoMotorista.nome}
            onChange={(e) =>
              setNovoMotorista({ ...novoMotorista, nome: e.target.value })
            }
          />
          <TextField
            fullWidth
            margin="dense"
            label="Email"
            value={novoMotorista.email}
            onChange={(e) =>
              setNovoMotorista({ ...novoMotorista, email: e.target.value })
            }
          />
          <TextField
            fullWidth
            margin="dense"
            type="password"
            label="Senha"
            value={novoMotorista.senha}
            onChange={(e) =>
              setNovoMotorista({ ...novoMotorista, senha: e.target.value })
            }
          />
          <TextField
            fullWidth
            margin="dense"
            label="CPF"
            value={novoMotorista.cpf}
            onChange={(e) =>
              setNovoMotorista({ ...novoMotorista, cpf: e.target.value })
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancelar</Button>
          <Button variant="contained" onClick={handleCadastrar}>
            Cadastrar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal Trocar Senha */}
      <Dialog
        open={modalSenhaAberto}
        onClose={() => setModalSenhaAberto(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          Trocar senha de {motoristaSelecionado?.nome}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            margin="dense"
            type="password"
            label="Nova senha"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalSenhaAberto(false)}>Cancelar</Button>
          <Button variant="contained" onClick={handleTrocarSenha}>
            Atualizar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          sx={{ width: "100%" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Backdrop
        open={false}
        sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <CircularProgress color="inherit" />
      </Backdrop>
    </Container>
  );
};

export default Motoristas;
