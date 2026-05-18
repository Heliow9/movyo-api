// services/ifoodAuth.js
const axios = require("axios");
const https = require("https");

const agent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
  minVersion: "TLSv1.2",
});

async function getIfoodToken() {
  try {
    const authUrl = "https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token";

    // corpo x-www-form-urlencoded
    const body = new URLSearchParams({
      grantType: "client_credentials",          // para app centralizado
      clientId: process.env.IFOOD_CLIENT_ID,
      clientSecret: process.env.IFOOD_CLIENT_SECRET,
    });

    const resp = await axios.post(authUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      httpsAgent: agent,
    });

    // normalmente vem como accessToken
    return resp.data.accessToken;
  } catch (err) {
    console.error("Erro ao obter token do iFood:", err.response?.status, err.response?.data);
    throw err;
  }
}

module.exports = { getIfoodToken, agent };
