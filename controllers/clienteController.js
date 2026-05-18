const Cliente = require('../models/Cliente');

const buscarClientePorTelefone = async (req, res) => {
  try {
    // Telefone recebido da rota (pode ter máscara ou não)
    const { telefone } = req.params;

    // Normaliza: remove tudo que não for número
    const telefoneLimpo = telefone.replace(/\D/g, "");

    if (!telefoneLimpo) {
      return res.status(400).json({ message: "Telefone inválido" });
    }

    // Busca compatível com clientes antigos e novos
    const cliente = await Cliente.findOne({
      $or: [
        { telefone: telefoneLimpo },          // clientes salvos normalizados
        { telefone: telefone },               // caso esteja salvo sem máscara
        { telefone: { $regex: telefoneLimpo } } // caso esteja salvo COM máscara
      ]
    });

    if (!cliente) {
      return res.status(404).json({ message: "Cliente não encontrado" });
    }

    res.json(cliente);

  } catch (err) {
    console.error("Erro ao buscar cliente:", err);
    res.status(500).json({
      error: "Erro ao buscar cliente",
      details: err.message
    });
  }
};

module.exports = {
  buscarClientePorTelefone,
};
