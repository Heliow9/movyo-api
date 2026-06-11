// src/components/Sidebar.jsx
import React, { useState, useEffect } from "react";
import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Typography,
  Box,
  Divider,
  useMediaQuery,
  Tooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Link, useLocation } from "react-router-dom";

import {
  FaHome,
  FaClipboardList,
  FaMotorcycle,
  FaCog,
  FaListUl,
  FaBars,
} from "react-icons/fa";

import PedidosEmAndamento from "./PedidosEmAndamento";

const Sidebar = () => {
  const theme = useTheme();
  const location = useLocation();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [mobileOpen, setMobileOpen] = useState(false);
  const [mostrarPedidos, setMostrarPedidos] = useState(false);

  const drawerWidth = 270;
  const gradient = "linear-gradient(135deg, #ff3b8a 0%, #ff9b2d 100%)";

  const menuItems = [
    { label: "Dashboard", icon: <FaHome />, path: "/" },
    { label: "Pedidos", icon: <FaClipboardList />, path: "/pedidos" },
    { label: "Motoristas", icon: <FaMotorcycle />, path: "/motoristas" },
    { label: "Produtos", icon: <FaListUl />, path: "/produtos" },
    { label: "Configurações", icon: <FaCog />, path: "/configuracoes" },
  ];

  // mesmo comportamento antigo: quando estiver na dashboard, depois de 10s abre pedidos
  useEffect(() => {
    if (location.pathname === "/") {
      const timer = setTimeout(() => setMostrarPedidos(true), 10000);
      return () => clearTimeout(timer);
    } else {
      setMostrarPedidos(false);
    }
  }, [location.pathname]);

  const handleToggleMobile = () => setMobileOpen((prev) => !prev);

  const drawerContent = (
    <Box
      sx={{
        height: "100%",
        p: 2,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#ffffff",
        borderRight: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      {/* HEADER */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        mb={2}
        px={0.5}
      >
        <Typography
          sx={{
            fontWeight: 800,
            fontSize: "1.2rem",
            background: gradient,
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          Movyo Food
        </Typography>

        <Tooltip
          title={
            mostrarPedidos ? "Voltar para o menu" : "Ver pedidos em andamento"
          }
        >
          <IconButton
            size="small"
            onClick={() => setMostrarPedidos((prev) => !prev)}
            sx={{ color: "#4b5563" }}
          >
            {mostrarPedidos ? <FaBars size={18} /> : <FaListUl size={18} />}
          </IconButton>
        </Tooltip>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* CONTEÚDO PRINCIPAL: menu OU pedidos */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {!mostrarPedidos ? (
          <List sx={{ width: "100%", pt: 0 }}>
            {menuItems.map((item) => {
              const active = location.pathname === item.path;
              return (
                <ListItemButton
                  key={item.path}
                  component={Link}
                  to={item.path}
                  sx={{
                    mb: 1,
                    borderRadius: 2,
                    py: 1.2,
                    px: 2,
                    background: active ? gradient : "transparent",
                    color: active ? "#fff" : "#333",
                    fontWeight: active ? 700 : 500,
                    boxShadow: active
                      ? "0 4px 12px rgba(0,0,0,0.15)"
                      : "none",
                    "&:hover": {
                      background: active
                        ? gradient
                        : "rgba(15,23,42,0.04)",
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      color: active ? "#fff" : "#6b7280",
                      minWidth: 36,
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontWeight: active ? 700 : 500,
                      fontSize: "0.95rem",
                    }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        ) : (
          // Pedidos em andamento no lugar do menu
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <PedidosEmAndamento />
          </Box>
        )}
      </Box>

      {/* RODAPÉ */}
      <Box mt={2}>
        <Typography
          variant="caption"
          sx={{ color: "#9ca3af", textAlign: "center", display: "block" }}
        >
          © Movyo Food {new Date().getFullYear()}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <>
      {/* Botão flutuante para abrir o menu no mobile */}
      {isMobile && (
        <IconButton
          onClick={handleToggleMobile}
          sx={{
            position: "fixed",
            top: 16,
            left: 16,
            zIndex: 1300,
            backgroundColor: "#ffffff",
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            "&:hover": {
              backgroundColor: "#f3f4f6",
            },
          }}
        >
          <FaBars />
        </IconButton>
      )}

      {isMobile ? (
        <Drawer
          variant="temporary"
          anchor="left"
          open={mobileOpen}
          onClose={handleToggleMobile}
          ModalProps={{ keepMounted: true }}
          sx={{
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              border: "none",
            },
          }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              border: "none",
              boxShadow: "4px 0 20px rgba(0,0,0,0.05)",
            },
          }}
        >
          {drawerContent}
        </Drawer>
      )}
    </>
  );
};

export default Sidebar;
