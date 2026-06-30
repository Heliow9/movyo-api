// src/components/PedidosEmAndamento.jsx
import React, { useEffect, useState, useRef } from "react";
import {
  Typography,
  List,
  Paper,
  Box,
  Divider,
  Button,
  Menu,
  MenuItem,
  Chip,
  Checkbox,
  TextField,
  InputAdornment,
  Fade,
} from "@mui/material";
import {
  FaMapMarkerAlt,
  FaPhone,
  FaMoneyBillWave,
  FaSearch,
} from "react-icons/fa";
import { useMapContext } from "../Context/MapContext";
import axios from "axios";
import { usePedidos } from "../Context/PedidosContext";
import { io } from "socket.io-client";

const API_BASE = "http://localhost:10000";
const PEDIDOS_POR_ENTREGADOR = 3;


const PedidosEmAndamento = () => {
  const { selectedPosition, setSelectedPosition, setPedidosMap } =
    useMapContext();
  const { atualizarPedidos } = usePedidos();

  const [pedidos, setPedidos] = useState([]);
  const [isSendingPedido, setIsSendingPedido] = useState({});
  const [deliverers, setDeliverers] = useState([]);
  const [anchorEl, setAnchorEl] = useState({});
  const [selectedDeliverer, setSelectedDeliverer] = useState({});
  const [selectedPedidos, setSelectedPedidos] = useState([]);
  const [anchorElMulti, setAnchorElMulti] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [mounted, setMounted] = useState(false);
  const [pulseMap, setPulseMap] = useState({}); // 👈 controla pulsar por id

  const socket = useRef(null);
  const restauranteId = localStorage.getItem("_id");

  useEffect(() => {
    setMounted(true);
  }, []);

  // 🔌 SOCKET
  useEffect(() => {
    const socketInstance = io(API_BASE, {
      transports: ["websocket", "polling"],
    });
    socket.current = socketInstance;

    socket.current.on("connect", () => {
      console.log("✅ [Dashboard] Socket conectado:", socket.current.id);
      socket.current.emit("joinRestaurante", { restauranteId });

      setTimeout(() => {
        socket.current.emit("joinRestaurante", { restauranteId });
        console.log("🔁 Reemissão manual de joinRestaurante");
      }, 2000);
    });

    socket.current.on("pedidoAceito", (pedidoAtualizado) => {
      console.log("✅ pedidoAceito:", pedidoAtualizado);

      setPedidos((prev) => {
        const prevPedido = prev.find((p) => p._id === pedidoAtualizado._id);

        // 🔔 se mudou para em_entrega, ativa animação de pulsar
        if (
          prevPedido &&
          prevPedido.status !== "em_entrega" &&
          pedidoAtualizado.status === "em_entrega"
        ) {
          setPulseMap((pm) => ({ ...pm, [pedidoAtualizado._id]: true }));

          // desliga pulsar depois de 1s
          setTimeout(() => {
            setPulseMap((pm) => ({ ...pm, [pedidoAtualizado._id]: false }));
          }, 1000);
        }

        return prev.map((p) =>
          p._id === pedidoAtualizado._id ? pedidoAtualizado : p
        );
      });
    });

    socket.current.on("pedidoRecusado", (pedidoAtualizado) => {
      console.log("🔄 pedidoRecusado:", pedidoAtualizado);
      setPedidos((prev) =>
        prev.map((p) => (p._id === pedidoAtualizado._id ? pedidoAtualizado : p))
      );
      setIsSendingPedido((prev) => ({
        ...prev,
        [pedidoAtualizado._id]: false,
      }));
    });

    socket.current.on("connect_error", (err) => {
      console.error("❌ Erro na conexão com socket:", err.message);
    });

    socket.current.on("deliverersOnline", (data) => {
      const available = Array.isArray(data)
        ? data.filter((d) => d.status === true)
        : [];
      setDeliverers(available);
    });

    socket.current.on("novoPedido", (pedidoNovo) => {
      console.log("🆕 novoPedido:", pedidoNovo);
      setPedidos((prev) => [pedidoNovo, ...prev]);
      setPedidosMap((prev) => [pedidoNovo, ...prev]);
    });

    return () => {
      socket.current?.disconnect();
      console.log("🔌 Socket do dashboard desconectado");
    };
  }, [restauranteId, setPedidosMap]);

  // 🔄 BUSCA INICIAL
  useEffect(() => {
    if (!restauranteId) return; // 👈 importantíssimo

    async function handlerGetPedidos() {
      try {
        const response = await axios.get(`${API_BASE}/api/pedidos/${restauranteId}`);
        console.log("Pedidos API:", response.data);
        setPedidos(Array.isArray(response.data) ? response.data : (response.data?.pedidos || []));
        setPedidosMap(Array.isArray(response.data) ? response.data : (response.data?.pedidos || []));
      } catch (error) {
        console.error("❌ Erro ao buscar pedidos:", error);
      }
    }

    handlerGetPedidos();
  }, [restauranteId, atualizarPedidos, setPedidosMap]);

  // 🎯 ENVIO INDIVIDUAL
  const enviarParaEntregador = (pedidoId) => {
    const deliverer = selectedDeliverer[pedidoId];
    if (deliverer && socket.current) {
      setIsSendingPedido((prev) => ({ ...prev, [pedidoId]: true }));

      socket.current.emit("enviarPedido", {
        pedidoId,
        delivererId: deliverer._id,
        restauranteId,
      });

      setTimeout(() => {
        axios
          .get(`${API_BASE}/api/pedidos/${pedidoId}`)
          .then((res) => {
            if (res.data.status === "aguardando_resposta") {
              return axios.put(`${API_BASE}/api/pedidos/${pedidoId}`, {
                status: "em_entrega",
              });
            }
          })
          .then(() => {
            setIsSendingPedido((prev) => ({ ...prev, [pedidoId]: false }));
            atualizarPedidos();
          })
          .catch((err) => console.error("❌ Erro ao reverter pedido:", err));
      }, 120000);
    }
  };

  // MENUS / MULTI
  const handleMenuClick = (event, pedidoId) => {
    event.stopPropagation();
    setAnchorEl((prev) => ({ ...prev, [pedidoId]: event.currentTarget }));
  };

  const handleMenuClose = (pedidoId) => {
    setAnchorEl((prev) => ({ ...prev, [pedidoId]: null }));
  };

  const handleDelivererSelect = (pedidoId, deliverer) => {
    setSelectedDeliverer((prev) => ({ ...prev, [pedidoId]: deliverer }));
    handleMenuClose(pedidoId);
    enviarParaEntregador(pedidoId);
  };

  const togglePedidoSelecionado = (pedidoId) => {
    setSelectedPedidos((prev) =>
      prev.includes(pedidoId)
        ? prev.filter((id) => id !== pedidoId)
        : [...prev, pedidoId]
    );
  };

  const handleAbrirMenuMulti = (event) => {
    if (selectedPedidos.length === 0) return;
    setAnchorElMulti(event.currentTarget);
  };

  const handleFecharMenuMulti = () => {
    setAnchorElMulti(null);
  };

  const handleEnviarMultiplos = (deliverer) => {
    const pedidosAtivosDoEntregador = pedidos.filter(
      (p) => p.entregador === deliverer._id && p.status !== "entregue"
    ).length;

    const disponivel = PEDIDOS_POR_ENTREGADOR - pedidosAtivosDoEntregador;
    const pedidosParaEnviar = selectedPedidos.slice(0, disponivel);

    pedidosParaEnviar.forEach((pedidoId) => {
      setSelectedDeliverer((prev) => ({ ...prev, [pedidoId]: deliverer }));

      if (deliverer && socket.current) {
        setIsSendingPedido((prev) => ({ ...prev, [pedidoId]: true }));

        socket.current.emit("enviarPedido", {
          pedidoId,
          delivererId: deliverer._id,
          restauranteId,
        });

        setTimeout(() => {
          axios
            .put(`${API_BASE}/api/pedidos/${pedidoId}`, {
              status: "em_entrega",
            })
            .then(() => {
              setIsSendingPedido((prev) => ({
                ...prev,
                [pedidoId]: false,
              }));
              atualizarPedidos();
            })
            .catch((err) => console.error("❌ Erro ao atualizar pedido:", err));
        }, 120000);
      }
    });

    handleFecharMenuMulti();
    setSelectedPedidos([]);
  };

  // STATUS
  const getStatusConfig = (status) => {
    const s = status?.toLowerCase();
    switch (s) {
      case "aguardando_pagamento":
      case "aguardando pagamento":
        return { label: "Aguardando", color: "#d97706", bg: "rgba(234,179,8,0.12)" };
      case "em_producao":
        return { label: "Em produção", color: "#2563eb", bg: "rgba(37,99,235,0.12)" };
      case "em_entrega":
        return { label: "Em entrega", color: "#fb923c", bg: "rgba(251,146,60,0.16)" };
      case "em_rota":
        return { label: "Em rota", color: "#7c3aed", bg: "rgba(124,58,237,0.16)" };
      case "entregue":
        return { label: "Entregue", color: "#16a34a", bg: "rgba(22,163,74,0.16)" };
      default:
        return {
          label: status || "Desconhecido",
          color: "#4b5563",
          bg: "rgba(148,163,184,0.18)",
        };
    }
  };

  // 🔎 FILTRO + BUSCA
  const pedidosBase = pedidos
    .filter(
      (pedido) =>
        pedido.status === "em_entrega" ||
        pedido.status === "aguardando_resposta" ||
        pedido.status === "em_rota"
    )
    .sort((a, b) => new Date(a.criadoEm) - new Date(b.criadoEm));

  const termo = searchTerm.trim().toLowerCase();

  const pedidosFiltrados = pedidosBase.filter((p) => {
    if (!termo) return true;
    const nome = (p.nomeCliente || "").toLowerCase();
    const numero = (p.numeroPedido || "").toLowerCase();
    const idCurto = p._id?.slice(-5)?.toLowerCase() || "";
    return (
      nome.includes(termo) ||
      numero.includes(termo) ||
      idCurto.includes(termo)
    );
  });

  return (
    <Box
      sx={{
        height: "100%",
        overflowY: "auto",
        pr: 1,
        "&::-webkit-scrollbar": { width: 4 },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "rgba(148,163,184,0.6)",
          borderRadius: 999,
        },
        scrollbarWidth: "thin",
      }}
    >
      {/* Cabeçalho + Busca */}
      <Box sx={{ mx: 1, mb: 1.5 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 800, color: "#083358", mb: 0.5 }}
        >
          Pedidos em andamento
        </Typography>

        <TextField
          fullWidth
          size="small"
          placeholder="Buscar por cliente ou #pedido..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          sx={{
            mt: 1,
            "& .MuiOutlinedInput-root": {
              borderRadius: 2,
              backgroundColor: "#ffffff",
              fontSize: "0.8rem",
              height: 36,
              "& fieldset": {
                borderColor: "rgba(148,163,184,0.5)",
              },
              "&:hover fieldset": {
                borderColor: "rgba(148,163,184,0.9)",
              },
              "&.Mui-focused fieldset": {
                borderColor: "#083358",
                borderWidth: 1,
              },
            },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <FaSearch size={13} color="#9ca3af" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Botão de multi-envio */}
      {selectedPedidos.length > 0 && (
        <Box sx={{ mx: 1, mb: 1 }}>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            onClick={handleAbrirMenuMulti}
            disabled={deliverers.length === 0}
            sx={{
              borderRadius: 999,
              textTransform: "none",
              fontSize: "0.75rem",
            }}
          >
            Escolher entregador ({selectedPedidos.length} pedidos)
          </Button>
        </Box>
      )}

      {pedidosFiltrados.length > 0 ? (
        <List sx={{ pt: 0 }}>
          {pedidosFiltrados.map((pedido, index) => {
            const statusCfg = getStatusConfig(pedido.status);
            const isActive = selectedPosition === pedido._id;
            const isPulsing = pulseMap[pedido._id];

            return (
              <Fade
                in={mounted}
                key={pedido._id}
                style={{ transitionDelay: `${index * 60}ms` }}
              >
                <Paper
                  elevation={0}
                  onMouseEnter={() => setSelectedPosition(pedido._id)} // 👈 hover foca no mapa
                  sx={{
                    backgroundColor: "#ffffff",
                    borderRadius: "14px",
                    p: 1.3,
                    mb: 1.2,
                    mx: 0.6,
                    border: `1px solid ${isActive
                        ? "rgba(255,59,138,0.75)"
                        : "rgba(0,0,0,0.08)"
                      }`,
                    boxShadow: isActive
                      ? "0 8px 22px rgba(255,59,138,0.25)"
                      : "0 4px 12px rgba(0,0,0,0.06)",
                    transition:
                      "transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease",
                    "&:hover": {
                      boxShadow: "0 8px 22px rgba(255,59,138,0.35)",
                      borderColor: "rgba(255,59,138,0.9)",
                      transform: "translateY(-2px)",
                    },
                    cursor: "pointer",
                    maxWidth: "100%",
                    // 🔔 keyframes + animação de pulsar
                    "@keyframes pulseCard": {
                      "0%": {
                        transform: "translateY(-2px) scale(1)",
                      },
                      "50%": {
                        transform: "translateY(-3px) scale(1.02)",
                        boxShadow: "0 10px 26px rgba(255,59,138,0.45)",
                        borderColor: "rgba(255,59,138,0.9)",
                      },
                      "100%": {
                        transform: "translateY(-2px) scale(1)",
                      },
                    },
                    ...(isPulsing && {
                      animation: "pulseCard 650ms ease-in-out 2",
                    }),
                  }}
                  onClick={() => setSelectedPosition(pedido._id)}
                >
                  {/* HEADER */}
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="flex-start"
                    mb={0.75}
                  >
                    {/* ESQUERDA */}
                    <Box display="flex" alignItems="flex-start" gap={1}>
                      <Checkbox
                        size="small"
                        checked={selectedPedidos.includes(pedido._id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => togglePedidoSelecionado(pedido._id)}
                        disabled={
                          pedido.status === "aguardando_resposta" ||
                          isSendingPedido[pedido._id] === true
                        }
                      />

                      <Box sx={{ maxWidth: 140 }}>
                        <Typography
                          sx={{
                            fontSize: "0.82rem",
                            fontWeight: 700,
                            color: "#111827",
                            lineHeight: 1.1,
                            wordBreak: "break-word",
                          }}
                        >
                          {pedido.nomeCliente}
                        </Typography>

                        <Typography
                          sx={{
                            fontSize: "0.7rem",
                            color: "#9ca3af",
                            mt: 0.2,
                          }}
                        >
                          Pedido
                        </Typography>

                        <Typography
                          sx={{
                            fontSize: "0.7rem",
                            color: "#6b7280",
                          }}
                        >
                          #{pedido.numeroPedido || pedido._id.slice(-5)}
                        </Typography>

                        {pedido.origem === "ifood" && (
                          <Chip
                            label="iFood"
                            size="small"
                            color="error"
                            sx={{
                              mt: 0.4,
                              height: 18,
                              fontSize: "0.65rem",
                            }}
                          />
                        )}
                      </Box>
                    </Box>

                    {/* DIREITA */}
                    <Box textAlign="right">
                      <Typography
                        sx={{
                          fontSize: "0.78rem",
                          fontWeight: 700,
                          color: "#111827",
                          whiteSpace: "nowrap",
                        }}
                      >
                        R$ {parseFloat(pedido.valorTotal || 0).toFixed(2)}
                      </Typography>

                      <Chip
                        label={statusCfg.label}
                        size="small"
                        sx={{
                          mt: 0.4,
                          borderRadius: 999,
                          fontSize: "0.65rem",
                          height: 18,
                          bgcolor: statusCfg.bg,
                          color: statusCfg.color,
                          maxWidth: 100,
                        }}
                      />
                    </Box>
                  </Box>

                  {/* ENDEREÇO / TELEFONE */}
                  <Box mb={0.75}>
                    <Box display="flex" alignItems="center" mb={0.25}>
                      <FaMapMarkerAlt
                        size={12}
                        style={{ marginRight: 6, color: "#6b7280" }}
                      />
                      <Typography
                        variant="body2"
                        sx={{
                          color: "#374151",
                          fontSize: "0.78rem",
                          wordBreak: "break-word",
                        }}
                      >
                        {pedido.enderecoCliente}
                      </Typography>
                    </Box>

                    <Box display="flex" alignItems="center">
                      <FaPhone
                        size={12}
                        style={{ marginRight: 6, color: "#6b7280" }}
                      />
                      <Typography
                        variant="body2"
                        sx={{ color: "#374151", fontSize: "0.78rem" }}
                      >
                        {pedido.telefoneCliente}
                      </Typography>
                    </Box>
                  </Box>

                  <Divider sx={{ my: 0.6 }} />

                  {/* ITENS */}
                  <Box>
                    {pedido.itens?.map((item, i) => (
                      <Typography
                        key={i}
                        variant="body2"
                        sx={{ color: "#4b5563", fontSize: "0.78rem" }}
                      >
                        {item.quantidade}x {item.nome}
                      </Typography>
                    ))}
                  </Box>

                  {/* MENU ENTREGADORES (caso use) */}
                  {anchorEl[pedido._id] && (
                    <Menu
                      anchorEl={anchorEl[pedido._id]}
                      open={Boolean(anchorEl[pedido._id])}
                      onClose={() => handleMenuClose(pedido._id)}
                    >
                      {deliverers.map((deliverer) => {
                        const pedidosAtivos = pedidos.filter(
                          (p) =>
                            p.entregador === deliverer._id &&
                            p.status !== "entregue"
                        ).length;

                        return (
                          <MenuItem
                            key={deliverer._id}
                            onClick={() =>
                              handleDelivererSelect(pedido._id, deliverer)
                            }
                            disabled={pedidosAtivos >= PEDIDOS_POR_ENTREGADOR}
                          >
                            <Typography variant="body2">
                              {deliverer.nome} ({pedidosAtivos}/
                              {PEDIDOS_POR_ENTREGADOR})
                            </Typography>
                          </MenuItem>
                        );
                      })}
                    </Menu>
                  )}
                </Paper>
              </Fade>
            );
          })}
        </List>
      ) : (
        <Typography
          variant="body2"
          sx={{ ml: 1.5, mt: 1, color: "#6b7280" }}
        >
          Nenhum pedido em andamento.
        </Typography>
      )}

      {/* Menu seleção múltipla */}
      {selectedPedidos.length > 0 && (
        <Menu
          anchorEl={anchorElMulti}
          open={Boolean(anchorElMulti)}
          onClose={handleFecharMenuMulti}
        >
          {deliverers.map((deliverer) => {
            const pedidosAtivos = pedidos.filter(
              (p) => p.entregador === deliverer._id && p.status !== "entregue"
            ).length;

            return (
              <MenuItem
                key={deliverer._id}
                onClick={() => handleEnviarMultiplos(deliverer)}
                disabled={pedidosAtivos >= PEDIDOS_POR_ENTREGADOR}
              >
                <Typography variant="body2">
                  {deliverer.nome} ({pedidosAtivos}/
                  {PEDIDOS_POR_ENTREGADOR})
                </Typography>
              </MenuItem>
            );
          })}
        </Menu>
      )}
    </Box>
  );
};

export default PedidosEmAndamento;
