// src/theme.js
import { createTheme } from "@mui/material/styles";

const primaryNavy = "#083358";      // azul escuro do texto/logo
const accentPink = "#ff3b8a";       // rosa do gradiente
const accentOrange = "#ff9b2d";     // laranja do gradiente;

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: primaryNavy,
    },
    secondary: {
      main: accentPink,
    },
    background: {
      default: "#050816",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: [
      "Inter",
      "system-ui",
      "-apple-system",
      "BlinkMacSystemFont",
      '"Segoe UI"',
      "Roboto",
      '"Helvetica Neue"',
      "Arial",
      "sans-serif",
    ].join(","),
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 20,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        "html, body, #root": {
          height: "100%",
        },
        body: {
          margin: 0,
          backgroundColor: "#050816",
          backgroundImage: `
            radial-gradient(circle at top left, rgba(255,59,138,0.25), transparent 55%),
            radial-gradient(circle at bottom right, rgba(255,155,45,0.25), transparent 55%)
          `,
        },
      },
    },
  },
});

export default theme;
