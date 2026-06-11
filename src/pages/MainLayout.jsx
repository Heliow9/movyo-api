// src/layouts/MainLayout.js
import React from "react";
import Sidebar from "../components/Sidebar";
import { Button, Box } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { Outlet, useNavigate } from "react-router-dom";

const MainLayout = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("token");
    navigate("/login");
  };

  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        <header className="header" style={headerStyle}>
      
          <Button
            variant="outlined"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
          >
            Sair
          </Button>
        </header>
        <Box className="dashboard-container">
          <Outlet />
        </Box>
      </div>
    </div>
  );
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 20px",
  backgroundColor: "#f5f5f5",
  borderBottom: "1px solid #ddd",
};

export default MainLayout;
