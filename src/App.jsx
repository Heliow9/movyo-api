import React from "react";
import { Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Pedidos from "./pages/Pedidos";
import Motoristas from "./pages/Motoristas";
import Configuracoes from "./pages/Configuracoes";
import Produtos from "./pages/Produtos";
import Publico from "./pages/Publico";
import PedidoSlugRedirect from "./pages/PedidoSlugRedirect";
import ErroRestaurante from "./pages/ErroRestaurante";
import Login from "./pages/Login";
import Carrinho from "./pages/Carrinho";
import Checkout from "./pages/Checkout";
import PedidosCliente from "./pages/PedidosCliente";
import Acompanhar from "./pages/Acompanhar";

import {
  Button,
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import AddIcon from "@mui/icons-material/Add";
import FullscreenIcon from "@mui/icons-material/Fullscreen";

import { useUI } from "../src/Context/UIContext";
import { isTokenExpired } from "./utils/auth";

// 🔐 Rota protegida usando <Outlet />
const ProtectedRoute = () => {
  const token = localStorage.getItem("token");

  if (!token || isTokenExpired()) {
    localStorage.removeItem("token");
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

// 🎨 Layout principal do painel (sidebar + topo + conteúdo)
const AppLayout = () => {
  const navigate = useNavigate();
  const { fullscreen, setFullscreen, setAbrirModalPedido } = useUI();

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  };

  const gradient = "linear-gradient(135deg, #ff3b8a 0%, #ff9b2d 100%)";

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",        // 👈 altura fixa da viewport
        overflow: "hidden",     // 👈 impede scroll na página
        backgroundColor: "transparent", // deixa o CssBaseline do tema aparecer
      }}
    >
      {!fullscreen && <Sidebar />}

      <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
        {/* Topo só quando não estiver em tela cheia */}
        {!fullscreen && (
          <AppBar
            elevation={0}
            position="static"
            sx={{
              backgroundImage: gradient,
              backgroundColor: "transparent",
              px: 2,
              height: 68,
              justifyContent: "center",
            }}
          >
            <Toolbar
              disableGutters
              sx={{
                minHeight: "unset",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Typography
                sx={{
                  fontSize: "1.05rem",
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Movyo Food — Painel de entregas
              </Typography>

              <Box display="flex" alignItems="center" gap={1.5}>
                <Button
                  onClick={() => setAbrirModalPedido(true)}
                  startIcon={<AddIcon />}
                  variant="contained"
                  size="small"
                  sx={{
                    backgroundImage: gradient,
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: "0.78rem",
                    textTransform: "none",
                    px: 2.4,
                    py: 0.8,
                    borderRadius: 999,
                    boxShadow:
                      "0 10px 24px rgba(255,59,138,0.35), 0 4px 12px rgba(0,0,0,0.22)",
                    "&:hover": {
                      filter: "brightness(1.05)",
                      boxShadow:
                        "0 12px 30px rgba(255,59,138,0.45), 0 6px 16px rgba(0,0,0,0.25)",
                    },
                  }}
                >
                  Novo pedido
                </Button>

                <Tooltip title="Exibir mapa em tela cheia">
                  <IconButton
                    size="small"
                    onClick={() => setFullscreen(true)}
                    sx={{
                      backgroundColor: "rgba(255,255,255,0.18)",
                      color: "#fff",
                      "&:hover": {
                        backgroundColor: "rgba(255,255,255,0.26)",
                      },
                    }}
                  >
                    <FullscreenIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<LogoutIcon />}
                  onClick={handleLogout}
                  sx={{
                    color: "#fff",
                    borderColor: "rgba(255,255,255,0.8)",
                    fontSize: "0.78rem",
                    textTransform: "none",
                    borderRadius: 999,
                    "&:hover": {
                      backgroundColor: "rgba(255,255,255,0.1)",
                      borderColor: "#fff",
                    },
                  }}
                >
                  Sair
                </Button>
              </Box>
            </Toolbar>
          </AppBar>
        )}

        {/* Conteúdo central com “cardzão” igual vibe do login */}
        <Box
          sx={{
            flexGrow: 1,
            p: { xs: 1.5, md: 3 },
            pt: { xs: 3, md: 4 },   // 👈 ADD AQUI O ESPAÇO!
            display: "flex",
          }}
        >

          <Box
            sx={{
              flexGrow: 1,
              display: "flex",
              flexDirection: "column",
              bgcolor: "#ffffff",
              borderRadius: 3,
              boxShadow: "0 22px 60px rgba(15,23,42,0.35)",
              p: { xs: 2, md: 3 },
              overflow: "hidden", // Dashboard controla o conteúdo
            }}
          >
            <Outlet />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};


const getUltimoSlugRestaurante = () => {
  try {
    const raw = JSON.parse(localStorage.getItem("restauranteSelecionado") || "null");
    const r = raw?.restaurante && typeof raw.restaurante === "object" ? raw.restaurante : raw;
    return r?.slugIdentificador || r?.slug || null;
  } catch {
    return null;
  }
};

const RedirectParaUltimaVitrine = () => {
  const slug = getUltimoSlugRestaurante();
  return <Navigate to={slug ? `/p/${slug}` : "/p"} replace />;
};

const App = () => {
  const token = localStorage.getItem("token");

  return (
    <Routes>
      {/* LOGIN – se já estiver logado, redireciona pra / */}
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <Login />}
      />

      {/* rotas públicas */}
      <Route path="/p/:slug" element={<Publico />} />
      <Route path="/p" element={<Publico />} />
      <Route path="/p/carrinho" element={<Carrinho />} />
      <Route path="/p/checkout" element={<Checkout />} />
      <Route path="/p/meus-pedidos/:telefone" element={<PedidosCliente />} />
      <Route path="/p/meus-pedidos" element={<PedidosCliente />} />
      <Route path="/acompanhar/:token" element={<Acompanhar />} />
      <Route path="/erro" element={<ErroRestaurante />} />

      {/* rotas protegidas */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="motoristas" element={<Motoristas />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="configuracoes" element={<Configuracoes />} />
        </Route>
      </Route>

      {/* qualquer rota inexistente volta para a última vitrine aberta */}
      <Route path="*" element={<RedirectParaUltimaVitrine />} />
    </Routes>
  );
};

export default App;
