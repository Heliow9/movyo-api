const axios = require("axios");
const https = require("https");

const BASE_URL = "https://sandbox.merchant-api.ifood.com.br";
const CLIENT_ID = process.env.IFOOD_CLIENT_ID;
const CLIENT_SECRET = process.env.IFOOD_CLIENT_SECRET;

const agent = new https.Agent({
  rejectUnauthorized: true,
  keepAlive: true,
  minVersion: "TLSv1.2",
});

// ⬇️ Define fora da função (cache de token)
let accessToken = null;
let tokenExpiresAt = null;

const getAccessToken = async () => {
  const now = Date.now();

  if (accessToken && tokenExpiresAt && now < tokenExpiresAt) {
    return accessToken;
  }

  try {
    const response = await axios.post(
      `${BASE_URL}/authentication/v1.0/oauth/token`,
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        httpsAgent: agent,
      }
    );

    accessToken = response.data.access_token;
    tokenExpiresAt = now + response.data.expires_in * 1000 - 10000;

    console.log("🔐 Novo token iFood obtido");
    return accessToken;
  } catch (error) {
    console.error("❌ Erro ao obter token do iFood:", error.response?.data || error.message);
    throw error;
  }
};

const getOrderDetails = async (orderId) => {
  const token = await getAccessToken();

  const response = await axios.get(`${BASE_URL}/order/v1.0/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    httpsAgent: agent,
  });

  return response.data;
};

const confirmOrder = async (orderId) => {
  const token = await getAccessToken();

  const response = await axios.post(
    `${BASE_URL}/order/v1.0/orders/${orderId}/confirm`,
    {},
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      httpsAgent: agent,
    }
  );

  return response.data;
};

module.exports = {
  getAccessToken,
  getOrderDetails,
  confirmOrder,
};
