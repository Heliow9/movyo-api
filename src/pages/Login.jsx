import React, { useState, useEffect, useRef } from "react";
import {
  TextField,
  Button,
  Paper,
  Typography,
  Box,
  CircularProgress,
  Fade,
  Popper,
  Paper as PopperPaper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  InputAdornment,
  IconButton,
  Snackbar,
  Alert,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import logo from "../assets/logo.png";
import { getRestauranteAccessBlockMessage, pickRestauranteFromPayload } from "../utils/licenseGuard";

const dominios = ["gmail.com", "hotmail.com", "outlook.com", "icloud.com"];

function Login() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const emailRef = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    setFadeIn(true);
    const notice = localStorage.getItem("movyo_login_notice");
    if (notice) {
      setErro(notice);
      localStorage.removeItem("movyo_login_notice");
    }
  }, []);

  const handleLogin = async () => {
    setErro("");

    if (!email || !senha) {
      setErro("Preencha todos os campos");
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(
        "https://api.movyo.delivery/api/restaurantes/login",
        { email, senha }
      );

      const restaurante = response.data?.restaurante || pickRestauranteFromPayload(response.data);
      const bloqueioMsg = getRestauranteAccessBlockMessage(restaurante);
      if (bloqueioMsg) {
        setErro(bloqueioMsg);
        return;
      }

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("_id", response.data.restaurante._id);
      navigate("/");
    } catch (err) {
      setErro(err.response?.data?.mensagem || "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailChange = (e) => {
    const val = e.target.value;
    setEmail(val);

    const [prefix, typedDomain] = val.split("@");

    if (val.includes("@") && !typedDomain?.includes(".")) {
      const filtered = dominios
        .filter((dom) => dom.startsWith(typedDomain || ""))
        .map((dom) => `${prefix}@${dom}`);
      setSuggestions(filtered);
      setAnchorEl(emailRef.current);
    } else {
      setSuggestions([]);
    }
  };

  const handleSuggestionClick = (suggested) => {
    setEmail(suggested);
    setSuggestions([]);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleLogin();
    }
  };

  const handleCloseErro = (_, reason) => {
    if (reason === "clickaway") return;
    setErro("");
  };

  const textFieldStyles = {
    "& .MuiOutlinedInput-root": {
      borderRadius: 3,
      backgroundColor: "#ffffff",
      "& fieldset": {
        borderColor: "#0b3055",
      },
      "&:hover fieldset": {
        borderColor: "#0d447a",
      },
      "&.Mui-focused fieldset": {
        borderWidth: 2,
        borderColor: "#0b3055",
      },
    },
    "& .MuiInputLabel-root": {
      color: "#6b7280",
      fontSize: "0.85rem",
    },
    "& .MuiInputLabel-root.Mui-focused": {
      color: "#0b3055",
    },
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: { xs: 2, sm: 3 },
        py: { xs: 4, sm: 0 },
        overflowY: { xs: "auto", sm: "hidden" },
      }}
    >
      <Fade in={fadeIn} timeout={600}>
        <Paper
          elevation={10}
          sx={{
            width: "100%",
            maxWidth: 430,
            p: { xs: 3, sm: 4 },
            borderRadius: 6,
            background:
              "radial-gradient(circle at top, rgba(255,59,138,0.12), transparent 60%), #ffffff",
            backdropFilter: "blur(8px)",
            position: "relative",
          }}
        >
          <Stack spacing={3} alignItems="center">
            {/* LOGO EM ANEL DEGRADÊ */}
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
              }}
            >
              {/* anel */}
              <Box
                sx={{
                  width: 130,
                  height: 130,
                  borderRadius: "50%",
                  background:
                    "linear-gradient(135deg, #ff3b8a 0%, #ff9b2d 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mb: 1,
                  boxShadow:
                    "0 10px 25px rgba(255,59,138,0.28), 0 6px 16px rgba(0,0,0,0.22)",
                  p: 0.5, // espessura do anel
                }}
              >
                {/* círculo interno branco */}
                <Box
                  sx={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "50%",
                    backgroundColor: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <img
                    src={logo}
                    alt="Movyo Food"
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: "contain",
                    }}
                  />
                </Box>
              </Box>

              <Typography
                variant="h5"
                sx={{
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  color: "primary.main",
                }}
              >
                Movyo Food
              </Typography>

              <Typography
                variant="body2"
                sx={{ color: "text.secondary", fontWeight: 500 }}
              >
                Painel do restaurante parceiro
              </Typography>
            </Box>

            {/* FORM */}
            <Box sx={{ width: "100%" }}>
              <TextField
                label="Email"
                placeholder="exemplo@email.com"
                fullWidth
                margin="normal"
                value={email}
                onChange={handleEmailChange}
                onKeyDown={handleKeyPress}
                inputRef={emailRef}
                sx={textFieldStyles}
              />

              <Popper
                open={suggestions.length > 0}
                anchorEl={anchorEl}
                style={{ zIndex: 1300 }}
              >
                <PopperPaper
                  sx={{
                    width: emailRef.current?.offsetWidth,
                    borderRadius: 2,
                    mt: 0.5,
                  }}
                >
                  <List dense>
                    {suggestions.map((suggestion) => (
                      <ListItem key={suggestion} disablePadding>
                        <ListItemButton
                          onClick={() => handleSuggestionClick(suggestion)}
                        >
                          <ListItemText primary={suggestion} />
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </PopperPaper>
              </Popper>

              <TextField
                label="Senha"
                type={mostrarSenha ? "text" : "password"}
                placeholder="********"
                fullWidth
                margin="normal"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={handleKeyPress}
                sx={textFieldStyles}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() =>
                          setMostrarSenha((prev) => !prev)
                        }
                      >
                        {mostrarSenha ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            {/* BOTÃO */}
            <Button
              fullWidth
              onClick={handleLogin}
              disabled={loading}
              sx={{
                mt: 1,
                py: 1.4,
                fontWeight: 700,
                fontSize: "0.95rem",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, #ff3b8a 0%, #ff9b2d 100%)",
                color: "#fff",
                boxShadow:
                  "0 12px 30px rgba(255,59,138,0.35), 0 6px 15px rgba(0,0,0,0.18)",
                "&:hover": {
                  background:
                    "linear-gradient(135deg, #ff4b92 0%, #ffae4a 100%)",
                  boxShadow:
                    "0 14px 34px rgba(255,59,138,0.45), 0 6px 18px rgba(0,0,0,0.22)",
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  transform: "translateY(1px)",
                  boxShadow:
                    "0 8px 18px rgba(255,59,138,0.3), 0 4px 10px rgba(0,0,0,0.2)",
                },
              }}
            >
              {loading ? (
                <CircularProgress size={22} sx={{ color: "#fff" }} />
              ) : (
                "Entrar no painel"
              )}
            </Button>

            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                mt: 1,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              Acesso exclusivo para restaurantes cadastrados na Movyo Food.
            </Typography>
          </Stack>

          {/* TOAST DE ERRO – CANTO INFERIOR DIREITO */}
          <Snackbar
            open={Boolean(erro)}
            autoHideDuration={5000}
            onClose={handleCloseErro}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          >
            <Alert
              onClose={handleCloseErro}
              severity="error"
              variant="filled"
              sx={{
                borderRadius: 999,
                boxShadow:
                  "0 10px 24px rgba(0,0,0,0.3)",
                px: 2.5,
              }}
            >
              {erro}
            </Alert>
          </Snackbar>
        </Paper>
      </Fade>
    </Box>
  );
}

export default Login;
