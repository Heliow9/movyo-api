const Restaurante = require("../models/Restaurante");
const Produto = require("../models/Produto");
const CategoriaProduto = require("../models/CategoriaProduto");
const Mesa = require("../models/mesaModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { criarRecipient } = require("../services/criarRecipientPagarme");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Gerar token JWT
const gerarToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
};

// remove chaves que NÃO podem ser atualizadas por /configuracoes
function sanitizeConfiguracoesPayload(body) {
  const clean = { ...(body || {}) };

  // 🚫 não deixa sobrescrever integrações sensíveis / controladas por outros fluxos
  delete clean.mercadoPago;
  delete clean.recipient_id;
  delete clean.senha;
  delete clean.email;
  delete clean.cnpj;

  return clean;
}

// ✅ normaliza configs numéricas (porque findByIdAndUpdate NÃO roda pre('save'))
function normalizeConfiguracoesPayload(clean) {
  const out = { ...(clean || {}) };

  // compat: se ainda vier o campo antigo do front
  if (
    out.maxPedidosPorEntregador == null &&
    Object.prototype.hasOwnProperty.call(out, "pedidosPorEntregador")
  ) {
    out.maxPedidosPorEntregador = out.pedidosPorEntregador;
  }

  if (Object.prototype.hasOwnProperty.call(out, "tempoMedioEntregaMin")) {
    const n = Number(out.tempoMedioEntregaMin);
    out.tempoMedioEntregaMin = Number.isFinite(n) ? Math.max(1, Math.round(n)) : undefined;
  }

  if (Object.prototype.hasOwnProperty.call(out, "maxPedidosPorEntregador")) {
    const n = Number(out.maxPedidosPorEntregador);
    out.maxPedidosPorEntregador = Number.isFinite(n) ? Math.max(1, Math.round(n)) : undefined;
  }

  // não deixa setar undefined no banco
  if (out.tempoMedioEntregaMin === undefined) delete out.tempoMedioEntregaMin;
  if (out.maxPedidosPorEntregador === undefined) delete out.maxPedidosPorEntregador;

  return out;
}


// helper: calcula flags públicas consistentes
function buildPublicPaymentFlags(restaurante) {
  const mpConectado = !!restaurante?.mercadoPago?.conectado;
  const pagamentoCartaoAtivo = !!restaurante?.pagamentoCartaoAtivo && mpConectado;
  const taxaCartaoCreditoAvistaPercent = Number(restaurante?.taxaCartaoCreditoAvistaPercent || 3.8);

  return { mpConectado, pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent };
}

module.exports = {
  // POST /api/restaurantes/register
  async register(req, res) {
    try {
      const { nome, email, senha, cnpj, localizacao, contaBancaria } = req.body;

      const restauranteExistente = await Restaurante.findOne({ email });
      if (restauranteExistente) {
        return res.status(400).json({ mensagem: "Email já cadastrado." });
      }

      const senhaHash = await bcrypt.hash(senha, 10);
      const recipient_id = await criarRecipient({ nome, cnpj, contaBancaria });

      const novoRestaurante = await Restaurante.create({
        nome,
        email,
        senha: senhaHash,
        cnpj,
        localizacao,
        recipient_id,
      });

      const token = gerarToken(novoRestaurante._id);
      return res.status(201).json({ token, restaurante: novoRestaurante });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensagem: "Erro ao cadastrar restaurante." });
    }
  },

  // POST /api/restaurantes/:id/recipient
  async criarRecipientManual(req, res) {
    const { id } = req.params;
    const {
      bank,
      branch_number,
      branch_check_digit,
      account_number,
      account_check_digit,
      type,
    } = req.body;

    try {
      const restaurante = await Restaurante.findById(id);
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      if (!restaurante.nome || !restaurante.cnpj) {
        return res
          .status(400)
          .json({ mensagem: "Nome e CNPJ são obrigatórios para criar recipient." });
      }

      const contaBancaria = {
        bank,
        branch_number,
        branch_check_digit,
        account_number,
        account_check_digit,
        type: type || "checking",
      };

      const cnpjLimpo = restaurante.cnpj.replace(/\D/g, "");
      if (cnpjLimpo.length !== 14) {
        return res.status(400).json({ mensagem: "CNPJ inválido." });
      }

      const recipient_id = await criarRecipient({
        nome: restaurante.nome,
        email: restaurante.email || `${cnpjLimpo}@rapigo.com.br`,
        cnpj: cnpjLimpo,
        contaBancaria,
      });

      restaurante.recipient_id = recipient_id;
      await restaurante.save();

      return res.status(200).json({
        mensagem: "Recipient criado com sucesso.",
        recipient_id,
      });
    } catch (err) {
      console.error("Erro ao criar recipient manual:", err?.response?.data || err.message);
      return res.status(500).json({ mensagem: "Erro ao criar recipient", erro: err.message });
    }
  },

  // POST /api/restaurantes/login
  async loginRestaurant(req, res) {
    try {
      const { email, senha } = req.body;

      const restaurante = await Restaurante.findOne({ email });
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      const senhaConfere = await bcrypt.compare(senha, restaurante.senha);
      if (!senhaConfere) {
        return res.status(401).json({ mensagem: "Senha incorreta." });
      }

      const token = gerarToken(restaurante._id);
      return res.status(200).json({ token, restaurante });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensagem: "Erro ao fazer login." });
    }
  },

  // PATCH /api/restaurantes/configuracoes/senha
  async trocarSenhaConfiguracoes(req, res) {
    try {
      const restauranteId = String(req.restauranteId || req.userId || req.jwt?.restauranteId || req.body?.restauranteId || req.params?.id || "");
      const body = req.body || {};
      const senhaAtual = body.senhaAtual || body.senhaAntiga || body.senha_atual || body.passwordAtual || body.currentPassword || body.senhaAtualRestaurante;
      const novaSenha = body.novaSenha || body.senhaNova || body.nova_senha || body.password || body.newPassword || body.senha;

      if (!restauranteId) {
        return res.status(401).json({ mensagem: "Restaurante não autenticado." });
      }
      if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ mensagem: "Informe a senha atual e a nova senha." });
      }
      if (String(novaSenha).length < 6) {
        return res.status(400).json({ mensagem: "A nova senha precisa ter pelo menos 6 caracteres." });
      }

      const restaurante = await Restaurante.findById(restauranteId);
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      const senhaConfere = await bcrypt.compare(String(senhaAtual), restaurante.senha || "");
      if (!senhaConfere) {
        return res.status(401).json({ mensagem: "Senha atual incorreta." });
      }

      const senhaHash = await bcrypt.hash(String(novaSenha), 10);
      restaurante.senha = senhaHash;

      if (typeof restaurante.save === "function") {
        await restaurante.save();
      } else if (typeof Restaurante.findByIdAndUpdate === "function") {
        await Restaurante.findByIdAndUpdate(restauranteId, { $set: { senha: senhaHash } });
      } else {
        throw new Error("Modelo Restaurante sem método de atualização de senha.");
      }

      return res.json({ ok: true, mensagem: "Senha atualizada com sucesso." });
    } catch (error) {
      console.error("Erro ao trocar senha do restaurante:", error);
      return res.status(500).json({ mensagem: "Erro ao atualizar a senha do restaurante.", erro: error.message });
    }
  },

  async teste(req, res) {
    res.send(req.body);
  },

  // GET /api/restaurantes/me (autenticado)
  async perfil(req, res) {
    try {
      const restauranteId = String(req.restauranteId || req.userId || req.jwt?.restauranteId || "");

      if (!restauranteId) {
        return res.status(401).json({ mensagem: "Restaurante não autenticado." });
      }

      const restaurante = await Restaurante.findById(restauranteId);
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      // Resposta limpa para o front. Não devolve objeto estilo Mongoose, senha, helpers internos
      // nem qualquer campo legado de MongoDB. A API segue usando MySQL.
      const payload = {
        id: restaurante.id || restaurante._id,
        _id: restaurante._id || restaurante.id, // compatibilidade com front/app já existente
        nome: restaurante.nome || "",
        email: restaurante.email || "",
        cnpj: restaurante.cnpj || "",
        telefone: restaurante.telefone || "",
        enderecoCep: restaurante.enderecoCep || "",
        enderecoRua: restaurante.enderecoRua || "",
        enderecoNumero: restaurante.enderecoNumero || "",
        enderecoBairro: restaurante.enderecoBairro || "",
        enderecoCidade: restaurante.enderecoCidade || "",
        enderecoEstado: restaurante.enderecoEstado || "",
        logoUrl: restaurante.logoUrl || "",
        logoSlug: restaurante.logoSlug || "",
        slugIdentificador: restaurante.slugIdentificador || "",
        horariosFuncionamento: restaurante.horariosFuncionamento || {},
        tempoMedioEntregaMin: restaurante.tempoMedioEntregaMin ?? 45,
        maxPedidosPorEntregador: restaurante.maxPedidosPorEntregador ?? restaurante.pedidosPorEntregador ?? 3,
        pedidosPorEntregador: restaurante.pedidosPorEntregador ?? restaurante.maxPedidosPorEntregador ?? 3,
        anotaaiStatus: !!restaurante.anotaaiStatus,
        anotaaiUrl: restaurante.anotaaiUrl || "",
        anotaaiIdentificador: restaurante.anotaaiIdentificador || "",
        anotaaiToken: restaurante.anotaaiToken || "",
        ifoodStatus: !!restaurante.ifoodStatus,
        ifoodIdentificador: restaurante.ifoodIdentificador || "",
        ifoodPrecisaConfirmacao: !!restaurante.ifoodPrecisaConfirmacao,
        ifoodIgnorarPronto: !!restaurante.ifoodIgnorarPronto,
        ifood: restaurante.ifood || {},
        localizacao: restaurante.localizacao || null,
        statusBot: restaurante.statusBot || {},
        ativo: restaurante.ativo !== false,
        mensagensPersonalizadas: restaurante.mensagensPersonalizadas || {},
        chavePix: restaurante.chavePix || "",
        recipient_id: restaurante.recipient_id || "",
        mercadoPago: restaurante.mercadoPago || {},
        pagamentoCartaoAtivo: restaurante.pagamentoCartaoAtivo !== false,
        taxaCartaoCreditoAvistaPercent: Number(restaurante.taxaCartaoCreditoAvistaPercent ?? 3.8),
        garcons: Array.isArray(restaurante.garcons) ? restaurante.garcons : [],
        plano: restaurante.plano || "anual",
        dataCadastro: restaurante.dataCadastro || restaurante.createdAt || null,
        createdAt: restaurante.createdAt || null,
        updatedAt: restaurante.updatedAt || null,
      };

      return res.json(payload);
    } catch (error) {
      console.error("Erro em /api/restaurantes/me:", error);
      return res.status(500).json({ mensagem: "Erro ao buscar restaurante.", erro: error.message });
    }
  },

  // GET /api/restaurantes/horario/:id
  async horarioPublico(req, res) {
    try {
      const restaurante = await Restaurante.findById(req.params.id);
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      return res.json({
        horarioInicio: restaurante.horarioInicio,
        horarioFim: restaurante.horarioFim,
        horariosFuncionamento: restaurante.horariosFuncionamento,

        // ✅ (opcional) já manda também os novos campos (se o front quiser)
        tempoMedioEntregaMin: restaurante.tempoMedioEntregaMin,
        maxPedidosPorEntregador: restaurante.maxPedidosPorEntregador,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensagem: "Erro ao buscar horário." });
    }
  },

  // ✅ GET /api/restaurantes/publico/:id
  async publicoById(req, res) {
    try {
      const { id } = req.params;

      const restaurante = await Restaurante.findById(id).select(
        [
          "nome",
          "logoUrl",
          "logoSlug",
          "slugIdentificador",
          "horariosFuncionamento",
          "enderecoRua",
          "enderecoNumero",
          "enderecoBairro",
          "enderecoCidade",
          "enderecoEstado",
          "pagamentoCartaoAtivo",
          "taxaCartaoCreditoAvistaPercent",
          "mercadoPago.conectado",
          "ativo",

          // ✅ novos campos
          "tempoMedioEntregaMin",
          "maxPedidosPorEntregador",
        ].join(" ")
      );

      if (!restaurante || !restaurante.ativo) {
        return res.status(404).json({ erro: "Restaurante não encontrado ou inativo." });
      }

      const { mpConectado, pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent } =
        buildPublicPaymentFlags(restaurante);

      return res.json({
        restaurante: {
          _id: restaurante._id,
          nome: restaurante.nome,
          logoUrl: restaurante.logoUrl,
          logoSlug: restaurante.logoSlug,
          slugIdentificador: restaurante.slugIdentificador,
          horariosFuncionamento: restaurante.horariosFuncionamento,
          endereco: {
            rua: restaurante.enderecoRua,
            numero: restaurante.enderecoNumero,
            bairro: restaurante.enderecoBairro,
            cidade: restaurante.enderecoCidade,
            estado: restaurante.enderecoEstado,
          },

          // ✅ novos campos
          tempoMedioEntregaMin: restaurante.tempoMedioEntregaMin,
          maxPedidosPorEntregador: restaurante.maxPedidosPorEntregador,

          // ✅ IMPORTANTÍSSIMO: dentro do objeto restaurante
          mpConectado,
          pagamentoCartaoAtivo,
          taxaCartaoCreditoAvistaPercent,
        },
      });
    } catch (err) {
      console.error("Erro publicoById:", err);
      return res.status(500).json({ erro: "Erro interno." });
    }
  },

  // PUT /api/restaurantes/configuracoes (autenticado)
  async atualizarConfiguracoes(req, res) {
    try {
      const restauranteId = req.userId;

      let dadosAtualizados = sanitizeConfiguracoesPayload(req.body);
      dadosAtualizados = normalizeConfiguracoesPayload(dadosAtualizados);

      // ✅ Regra: só permite ativar cartão se MP estiver conectado
      if (Object.prototype.hasOwnProperty.call(dadosAtualizados, "pagamentoCartaoAtivo")) {
        const rest = await Restaurante.findById(restauranteId).select("mercadoPago.conectado");
        const mpConectado = !!rest?.mercadoPago?.conectado;

        if (!mpConectado && dadosAtualizados.pagamentoCartaoAtivo === true) {
          dadosAtualizados.pagamentoCartaoAtivo = false;
        }
      }

      const restaurante = await Restaurante.findByIdAndUpdate(
        restauranteId,
        { $set: dadosAtualizados },
        { new: true }
      );

      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      return res.status(200).json({
        mensagem: "Configurações atualizadas com sucesso.",
        restaurante,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensagem: "Erro ao atualizar configurações." });
    }
  },

  // GET /api/restaurantes/:slug
  async restauranteSlug(req, res) {
    try {
      const { slug } = req.params;

      const restaurante = await Restaurante.findOne({ slugIdentificador: slug });
      if (!restaurante) {
        return res.status(404).json({ erro: "Restaurante não encontrado." });
      }

      const categorias = await CategoriaProduto.find({
        restaurante: restaurante._id,
        ativa: true,
      }).sort({ ordem: 1 });

      const produtos = await Produto.find({
        restaurante: restaurante._id,
        ativo: true,
      });

      const produtosPorCategoria = categorias.map((categoria) => {
        const {
          _id,
          nome,
          permiteSabores,
          pizzaMultisabor,
          calculoPrecoPor,
          tiposExtras,
          saboresDisponiveis,
          bordasDisponiveis,
          adicionaisDisponiveis,
          complementosDisponiveis,
          maxSabores: maxSaboresCategoria,
        } = categoria;

        const tipoCategoria = permiteSabores || pizzaMultisabor ? "pizza" : "simple_item";

        const maxSabores = Number(maxSaboresCategoria) || (pizzaMultisabor ? 2 : 1);

        const itens = produtos
          .filter((p) => String(p.categoria) === String(_id))
          .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
          .map((p) => ({
            _id: p._id,
            restaurante: p.restaurante,
            categoria: p.categoria,

            nome: p.nome,
            descricao: p.descricao,
            precoBase: p.precoBase,
            imagem: p.imagem,

            destaque: p.destaque === true,
            ordem: p.ordem || 0,

            sabores: p.sabores?.length ? p.sabores : (saboresDisponiveis || []),
            bordas: p.bordas?.length ? p.bordas : (bordasDisponiveis || []),
            adicionais: p.adicionais?.length ? p.adicionais : (adicionaisDisponiveis || []),
            complementos: p.complementos?.length
              ? p.complementos
              : (complementosDisponiveis || []),

            extras: p.extras || {},
            ativo: p.ativo,

            categoriaType: tipoCategoria,
            pizzaMultisabor: Boolean(pizzaMultisabor),
            calculoPrecoPor: calculoPrecoPor || "maior",
            tiposExtras: tiposExtras || [],
            maxSabores,
          }));

        return {
          _id,
          nome,
          tipo: tipoCategoria,
          tiposExtras: tiposExtras || [],
          pizzaMultisabor: Boolean(pizzaMultisabor),
          calculoPrecoPor: calculoPrecoPor || "maior",
          maxSabores,
          itens,
        };
      });

      const { mpConectado, pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent } =
        buildPublicPaymentFlags(restaurante);

      return res.json({
        restaurante: {
          _id: restaurante._id,
          nome: restaurante.nome,
          logoUrl: restaurante.logoUrl,
          logoSlug: restaurante.logoSlug,
          slugIdentificador: restaurante.slugIdentificador,
          horariosFuncionamento: restaurante.horariosFuncionamento,
          enderecoBairro: restaurante.enderecoBairro,
          enderecoCidade: restaurante.enderecoCidade,
          endereco: {
            rua: restaurante.enderecoRua,
            numero: restaurante.enderecoNumero,
            bairro: restaurante.enderecoBairro,
            cidade: restaurante.enderecoCidade,
            estado: restaurante.enderecoEstado,
          },

          // ✅ novos campos
          tempoMedioEntregaMin: restaurante.tempoMedioEntregaMin,
          maxPedidosPorEntregador: restaurante.maxPedidosPorEntregador,

          // ✅ IMPORTANTÍSSIMO: dentro do objeto restaurante
          mpConectado,
          pagamentoCartaoAtivo,
          taxaCartaoCreditoAvistaPercent,
        },
        produtosPorCategoria,
      });
    } catch (err) {
      console.error("Erro ao buscar restaurante pelo slug:", err);
      res.status(500).json({ erro: "Erro interno." });
    }
  },

  // GET /api/restaurantes/mesa/:qrCodeIdentifier
  async getDadosPublicosByMesa(req, res) {
    try {
      const { qrCodeIdentifier } = req.params;

      const mesa = await Mesa.findOne({ qrCodeIdentifier });
      if (!mesa) return res.status(404).json({ erro: "Mesa não encontrada." });

      const restaurante = await Restaurante.findById(mesa.restauranteId);
      if (!restaurante || !restaurante.ativo) {
        return res.status(404).json({ erro: "Restaurante não encontrado ou inativo." });
      }

      const categorias = await CategoriaProduto.find({
        restaurante: restaurante._id,
        ativa: true,
      }).sort({ ordem: 1 });

      const produtos = await Produto.find({ restaurante: restaurante._id, ativo: true });

      const produtosPorCategoria = categorias.map((categoria) => {
        const {
          _id,
          nome,
          permiteSabores,
          pizzaMultisabor,
          calculoPrecoPor,
          tiposExtras,
          saboresDisponiveis,
          bordasDisponiveis,
          adicionaisDisponiveis,
          complementosDisponiveis,
          maxSabores: maxSaboresCategoria,
        } = categoria;

        const tipoCategoria = permiteSabores || pizzaMultisabor ? "pizza" : "simple_item";
        const maxSabores = Number(maxSaboresCategoria) || (pizzaMultisabor ? 2 : 1);

        const itens = produtos
          .filter((p) => p.categoria.toString() === _id.toString())
          .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
          .map((p) => ({
            _id: p._id,
            nome: p.nome,
            descricao: p.descricao,
            precoBase: p.precoBase,
            imagem: p.imagem,

            destaque: p.destaque === true,
            ordem: p.ordem || 0,

            sabores: p.sabores?.length ? p.sabores : (saboresDisponiveis || []),
            bordas: p.bordas?.length ? p.bordas : (bordasDisponiveis || []),
            adicionais: p.adicionais?.length ? p.adicionais : (adicionaisDisponiveis || []),
            complementos: p.complementos?.length
              ? p.complementos
              : (complementosDisponiveis || []),

            extras: p.extras || {},
            ativo: p.ativo,

            categoriaType: tipoCategoria,
            pizzaMultisabor: Boolean(pizzaMultisabor),
            calculoPrecoPor: calculoPrecoPor || "maior",
            tiposExtras: tiposExtras || [],
            maxSabores,
          }));

        return {
          _id,
          nome,
          tipo: tipoCategoria,
          tiposExtras: tiposExtras || [],
          pizzaMultisabor: Boolean(pizzaMultisabor),
          calculoPrecoPor: calculoPrecoPor || "maior",
          maxSabores,
          itens,
        };
      });

      const { mpConectado, pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent } =
        buildPublicPaymentFlags(restaurante);

      return res.json({
        restaurante: {
          _id: restaurante._id,
          nome: restaurante.nome,
          logoUrl: restaurante.logoUrl,
          logoSlug: restaurante.logoSlug,
          slugIdentificador: restaurante.slugIdentificador,
          horariosFuncionamento: restaurante.horariosFuncionamento,
          endereco: {
            rua: restaurante.enderecoRua,
            numero: restaurante.enderecoNumero,
            bairro: restaurante.enderecoBairro,
            cidade: restaurante.enderecoCidade,
            estado: restaurante.enderecoEstado,
          },

          // ✅ novos campos
          tempoMedioEntregaMin: restaurante.tempoMedioEntregaMin,
          maxPedidosPorEntregador: restaurante.maxPedidosPorEntregador,

          // ✅ IMPORTANTÍSSIMO: dentro do objeto restaurante
          mpConectado,
          pagamentoCartaoAtivo,
          taxaCartaoCreditoAvistaPercent,
        },
        mesa: { _id: mesa._id, numero: mesa.numero },
        produtosPorCategoria,
      });
    } catch (err) {
      console.error("Erro ao buscar dados públicos pela mesa:", err);
      res.status(500).json({ erro: "Erro interno." });
    }
  },

  // POST /api/restaurantes/logo (autenticado) + multer.single("logo")
  async uploadLogo(req, res) {
    try {
      const restauranteId = String(req.restauranteId || req.userId || req.user?._id || req.user?.id || "");

      if (!req.file) {
        return res.status(400).json({ mensagem: "Arquivo de logo não enviado." });
      }

      if (!restauranteId) {
        return res.status(401).json({ mensagem: "Restaurante não identificado no token." });
      }

      const restaurante = await Restaurante.findById(restauranteId);
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      const baseUrl = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const logoSlug = `/uploads/logos/${req.file.filename}`;
      const logoUrl = `${baseUrl}${logoSlug}`;

      // remove arquivo antigo salvo pela própria API
      try {
        const oldSlug = restaurante.logoSlug || (restaurante.logoUrl?.includes("/uploads/") ? `/uploads/${restaurante.logoUrl.split("/uploads/")[1]}` : null);
        if (oldSlug && oldSlug.startsWith("/uploads/")) {
          const oldPath = path.join(__dirname, "..", oldSlug.replace(/^\/+/, ""));
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
      } catch (e) {
        console.warn("Não consegui apagar a logo antiga:", e?.message);
      }

      const atualizado = await Restaurante.findByIdAndUpdate(
        restauranteId,
        { $set: { logoUrl, logoSlug } },
        { new: true }
      );

      return res.status(200).json({
        ok: true,
        mensagem: "Logo enviada com sucesso.",
        logoUrl,
        logoSlug,
        restaurante: atualizado,
      });
    } catch (error) {
      console.error("Erro no uploadLogo:", error);
      return res.status(500).json({ mensagem: "Erro ao enviar logo.", erro: error.message });
    }
  },

  // PATCH /api/restaurantes/pagamento-cartao  (autenticado)
  async togglePagamentoCartao(req, res) {
    try {
      const restauranteId = req.userId;

      // aceita true/false
      const desejado = !!req.body?.pagamentoCartaoAtivo;

      // busca status do MP pra regra de segurança
      const rest = await Restaurante.findById(restauranteId).select(
        "mercadoPago.conectado pagamentoCartaoAtivo"
      );

      if (!rest) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      const mpConectado = !!rest?.mercadoPago?.conectado;

      // regra: só permite ativar se estiver conectado no MP
      if (desejado === true && !mpConectado) {
        return res.status(400).json({
          mensagem: "Conecte o Mercado Pago para ativar pagamento com cartão.",
          pagamentoCartaoAtivo: false,
          mpConectado: false,
        });
      }

      rest.pagamentoCartaoAtivo = desejado;
      await rest.save();

      return res.json({
        ok: true,
        mensagem: desejado ? "Cartão ativado na vitrine." : "Cartão desativado na vitrine.",
        pagamentoCartaoAtivo: !!rest.pagamentoCartaoAtivo,
        mpConectado,
      });
    } catch (error) {
      console.error("togglePagamentoCartao error:", error);
      return res.status(500).json({ mensagem: "Erro ao atualizar opção de cartão." });
    }
  },
};
