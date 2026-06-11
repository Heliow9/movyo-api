import React from "react";
import { Container, Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

const ErroRestaurante = () => {
  const navigate = useNavigate();
  const result = localStorage.getItem('restauranteSelecionado');

  return (
    <Container sx={{ mt: 10, textAlign: "center" }}>
      <Typography variant="h4" gutterBottom>
        Restaurante não encontrado
      </Typography>
      <Typography variant="body1" gutterBottom>
        O link pode estar incorreto ou o restaurante não está mais disponível .{result}
      </Typography>
      <Button variant="contained" color="primary" onClick={() => navigate("/")}>
        Voltar para Início
      </Button>
    </Container>
  );
};

export default ErroRestaurante;
