const express = require("express");
const axios = require("axios");
const { getIfoodToken, agent } = require("../services/ifoodAuthService");

const router = express.Router();

async function pollIfoodEvents() {
  try {
    console.log("Iniciando polling iFood...");

    const token = await getIfoodToken();

    const baseUrl = "https://merchant-api.ifood.com.br"; // pode pôr em ENV se quiser

    const resp = await axios.get(`${baseUrl}/order/v1.0/events:polling`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // recomendado para app centralizado (quando tiver o merchantId de teste):
        // "x-polling-merchants": process.env.IFOOD_MERCHANT_ID,
      },
      httpsAgent: agent,
    });

    if (resp.status === 204) {
      console.log("Sem eventos novos no iFood.");
      return;
    }

    console.log("Eventos recebidos do iFood:", resp.data);

    // aqui você converte os eventos em pedidos e joga na sua Dashboard
    // ex: resp.data.forEach(event => { ... });

  } catch (err) {
    console.error(
      "Erro no polling iFood:",
      err.response?.status,
      err.response?.data || err.message
    );
  }
}

// só um endpoint de teste pra disparar manualmente
router.get("/ifood/poll", async (req, res) => {
  await pollIfoodEvents();
  res.json({ ok: true });
});

module.exports = router;
