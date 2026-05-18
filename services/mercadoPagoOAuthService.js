// services/mercadoPagoOAuthService.js
const axios = require("axios");
const MP_API = "https://api.mercadopago.com";

async function trocarCodePorToken(code, codeVerifier) {
  const body = new URLSearchParams({
    client_id: process.env.MP_CLIENT_ID,
    client_secret: process.env.MP_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MP_REDIRECT_URI,
    code_verifier: codeVerifier,
  }).toString();

  const res = await axios.post(`${MP_API}/oauth/token`, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  return res.data;
}

module.exports = { trocarCodePorToken };
