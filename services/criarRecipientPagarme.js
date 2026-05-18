const axios = require("axios");



const PAGARME_API_KEY = "sk_test_146350bc4ec840e4b046d68a06668444";

async function criarRecipient({ nome, email, cnpj, contaBancaria }) {
  try {
    if (!contaBancaria || !contaBancaria.bank || !contaBancaria.account_number) {
      throw new Error("Dados bancários inválidos ou incompletos.");
    }

    const response = await axios.post(
      "https://api.pagar.me/core/v5/recipients",
      {
        name: nome,
        email,
        description: `Restaurante ${nome}`,
        document: cnpj.replace(/\D/g, ""),
        type: "company",
        default_bank_account: {
          holder_name: nome,
          holder_type: "company",
          holder_document: cnpj.replace(/\D/g, ""),
          bank: contaBancaria.bank,
          branch_number: contaBancaria.branch_number || "0001",
          branch_check_digit: contaBancaria.branch_check_digit || "0",
          account_number: contaBancaria.account_number,
          account_check_digit: contaBancaria.account_check_digit,
          type: contaBancaria.type || "checking"
        },
        transfer_settings: {
          transfer_enabled: true,
          transfer_interval: "daily",
          transfer_day: 0
        },
        automatic_anticipation_settings: {
          enables: false
        },
        metadata: {
          origem: "gotrack"
        }
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(PAGARME_API_KEY + ":").toString("base64")}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.id;
  } catch (err) {
    console.error("❌ Erro ao criar recipient:", err?.response?.data || err.message);
    throw new Error("Falha ao criar recipient no Pagar.me");
  }
}

module.exports = { criarRecipient };
