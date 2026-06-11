// src/pages/Dashboard.jsx
import React, { useState, useEffect } from "react";
import {
  Box,
  Fade,
  Slide,
  Snackbar,
  Paper,
  IconButton,
  Typography,
  Grid,
  Stack,
  Chip,
  Divider,
} from "@mui/material";
import FullscreenExitIcon from "@mui/icons-material/FullscreenExit";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import QueryBuilderIcon from "@mui/icons-material/QueryBuilder";

import { useUI } from "../../src/Context/UIContext";
import Mapa from "../components/Mapa";
import ModalPedido from "../components/ModalPedido";
import PedidosEmAndamento from "../components/PedidosEmAndamento";

// Card ultra compacto
const StatCard = ({ label, value, chipLabel, icon, accent }) => {
  return (
    <Paper
      elevation={1}
      sx={{
        p: 1.2,
        borderRadius: 1.8,
        background: "rgba(255,255,255,0.7)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        height: "auto",
        minHeight: 65,
        justifyContent: "center",
        border: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <Typography
          sx={{
            fontSize: "0.70rem",
            fontWeight: 600,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: 0.3,
          }}
        >
          {label}
        </Typography>

        {chipLabel && (
          <Chip
            label={chipLabel}
            size="small"
            sx={{
              height: 18,
              fontSize: "0.60rem",
              borderRadius: "999px",
              px: 0.6,
              bgcolor: "rgba(8,51,88,0.06)",
              color: "#083358",
            }}
          />
        )}
      </Stack>

      <Stack direction="row" alignItems="center" spacing={0.8}>
        {icon && (
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: accent || "rgba(8,51,88,0.05)",
              fontSize: "0.7rem",
            }}
          >
            {icon}
          </Box>
        )}

        <Typography
          sx={{
            fontSize: "1rem",
            fontWeight: 800,
            color: "#111827",
          }}
        >
          {value}
        </Typography>
      </Stack>
    </Paper>
  );
};

const Dashboard = () => {
  const [modalAberto, setModalAberto] = useState(false);
  const { fullscreen, setFullscreen } = useUI();
  const [showToast, setShowToast] = useState(false);
  const [animarSaida, setAnimarSaida] = useState(false);

  // Atalho Ctrl+P abre modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setModalAberto(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Toast ao entrar em fullscreen
  useEffect(() => {
    if (fullscreen) setShowToast(true);
  }, [fullscreen]);

  const desativarFullscreen = () => {
    // dispara animação de saída
    setAnimarSaida(true);
    setTimeout(() => {
      setFullscreen(false);
      setAnimarSaida(false);
    }, 300); // mesmo timing dos Fades/Slides
  };

  // 🔢 mock das métricas
  const totalHoje = 32;
  const emAndamento = 7;
  const tempoMedio = "28 min";
  const taxaSucesso = "96%";

  return (
    <>
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: fullscreen ? 0 : 2.5,
          minHeight: 0,
        }}
      >
        {/* Cabeçalho + métricas só quando NÃO estiver em fullscreen */}
        {!fullscreen && (
          <>
            <Box>
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, color: "#0f172a", mb: 0.5 }}
              >
                Visão geral
              </Typography>
              <Typography variant="body2" sx={{ color: "#6b7280" }}>
                Acompanhe entregas em tempo real e o desempenho do seu
                restaurante.
              </Typography>
            </Box>

            <Divider
              sx={{ borderColor: "rgba(148,163,184,0.4)", mb: 0.5 }}
            />

            <Grid container spacing={0.5}>
              <Grid item xs={12} sm={6} md={3}>
                <StatCard
                  label="Pedidos hoje"
                  value={totalHoje}
                  chipLabel="Últimas 24h"
                  icon={
                    <LocalShippingIcon
                      sx={{ fontSize: 18, color: "#ff3b8a" }}
                    />
                  }
                  accent="rgba(255,59,138,0.12)"
                />
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <StatCard
                  label="Em andamento"
                  value={emAndamento}
                  chipLabel="Motoboys na rua"
                  icon={
                    <AccessTimeIcon sx={{ fontSize: 18, color: "#083358" }} />
                  }
                  accent="rgba(8,51,88,0.08)"
                />
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <StatCard
                  label="Tempo médio de entrega"
                  value={tempoMedio}
                  chipLabel="Hoje"
                  icon={
                    <TrendingUpIcon
                      sx={{ fontSize: 18, color: "#ff9b2d" }}
                    />
                  }
                  accent="rgba(255,155,45,0.15)"
                />
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <StatCard
                  label="Taxa de sucesso"
                  value={taxaSucesso}
                  chipLabel="Pedidos entregues"
                  icon={
                    <TrendingUpIcon
                      sx={{ fontSize: 18, color: "#16a34a" }}
                    />
                  }
                  accent="rgba(22,163,74,0.12)"
                />
              </Grid>
            </Grid>
          </>
        )}

        {/* Área do mapa – mesma instância em ambos os modos */}
        <Box sx={{ flex: 1, minHeight: 260, mt: fullscreen ? 0 : 1 }}>
          <Paper
            elevation={fullscreen ? 0 : 4}
            sx={{
              position: fullscreen ? "fixed" : "relative",
              inset: fullscreen ? 0 : "auto",
              height: fullscreen ? "100vh" : "100%",
              width: fullscreen ? "100vw" : "100%",
              borderRadius: fullscreen ? 0 : 3,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              backgroundColor: "#ffffff",
              zIndex: fullscreen ? 999 : 1,
            }}
          >
            {/* Barra de título do card – só no modo normal */}
            {!fullscreen && (
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  borderBottom: "1px solid rgba(148,163,184,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  bgcolor: "rgba(255,255,255,0.95)",
                }}
              >
                <Box>
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 700, color: "#0f172a" }}
                  >
                    Entregas em tempo real
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: "#6b7280", fontWeight: 500 }}
                  >
                    Motoboys, pedidos e restaurante no mapa.
                  </Typography>
                </Box>

                <Chip
                  size="small"
                  icon={<QueryBuilderIcon sx={{ fontSize: 16 }} />}
                  label="Atualizado em tempo real"
                  sx={{
                    borderRadius: 999,
                    fontSize: "0.7rem",
                    bgcolor: "rgba(8,51,88,0.06)",
                    color: "#083358",
                  }}
                />
              </Box>
            )}

            {/* Conteúdo do mapa */}
            <Box
              sx={{
                position: "relative",
                flex: 1,
                minHeight: { xs: 260, md: 320 },
              }}
            >
              {/* 🔵 Mapa – passa fullscreen como prop */}
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                }}
              >
                <Mapa fullscreen={fullscreen} />
              </Box>

              {/* Overlays do fullscreen */}
              {fullscreen && (
                <>
                  {/* overlay de saída (fade branco) */}
                  <Fade in={animarSaida} timeout={250}>
                    <Box
                      sx={{
                        position: "fixed",
                        inset: 0,
                        bgcolor: "#ffffff",
                        zIndex: 1000,
                        pointerEvents: "none",
                      }}
                    />
                  </Fade>

                  {/* Mensagem topo */}
                  <Fade in={!animarSaida} timeout={300}>
                    <Box
                      position="fixed"
                      top={8}
                      left="50%"
                      zIndex={1010}
                      sx={{
                        transform: "translateX(-50%)",
                        backgroundColor: "#333",
                        color: "#fff",
                        px: 2,
                        py: 0.5,
                        borderRadius: 1,
                        fontSize: 12,
                        opacity: 0.9,
                      }}
                    >
                      Modo Tela Cheia Ativado
                    </Box>
                  </Fade>

                  {/* Botão sair fullscreen */}
                  <Fade in={!animarSaida} timeout={300}>
                    <Box
                      position="fixed"
                      top={16}
                      right={16}
                      zIndex={1010}
                    >
                      <IconButton
                        onClick={desativarFullscreen}
                        sx={{
                          backgroundColor: "#fff",
                          boxShadow: 2,
                          "&:hover": {
                            transform: "scale(1.1)",
                            backgroundColor: "#f0f0f0",
                          },
                        }}
                      >
                        <FullscreenExitIcon />
                      </IconButton>
                    </Box>
                  </Fade>

                  {/* Painel lateral de pedidos */}
                  <Fade in={!animarSaida} timeout={300}>
                    <Slide
                      direction="right"
                      in={!animarSaida}
                      timeout={300}
                    >
                      <Paper
                        elevation={3}
                        sx={{
                          position: "fixed",
                          top: 24,
                          left: 24,
                          width: { xs: "90vw", sm: "360px" },
                          maxHeight: "calc(100% - 48px)",
                          overflowY: "auto",
                          backdropFilter: "blur(8px)",
                          backgroundColor: "rgba(255,255,255,0.8)",
                          borderRadius: 2,
                          p: 2,
                          zIndex: 1005,
                        }}
                      >
                        <PedidosEmAndamento />
                      </Paper>
                    </Slide>
                  </Fade>
                </>
              )}
            </Box>
          </Paper>
        </Box>
      </Box>

      {/* Modal de novo pedido (atalho Ctrl+P) */}
      <ModalPedido
        isOpen={modalAberto}
        onClose={() => setModalAberto(false)}
      />

      {/* Toast fullscreen */}
      <Snackbar
        open={showToast}
        autoHideDuration={2000}
        onClose={() => setShowToast(false)}
        message="Modo fullscreen ativado"
      />
    </>
  );
};

export default Dashboard;
