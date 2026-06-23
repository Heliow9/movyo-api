
const isProdutoDestaque = (p = {}) => {
  const v = p.destaque ?? p.emDestaque ?? p.isDestaque ?? p.destaqueVitrine;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return ['true', '1', 'sim', 'yes', 's'].includes(v.trim().toLowerCase());
  return false;
};

const Restaurante = require("../models/Restaurante");
const Produto = require("../models/Produto");
const CategoriaProduto = require("../models/CategoriaProduto");
const Mesa = require("../models/mesaModel");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { criarRecipient } = require("../services/criarRecipientPagarme");
const { resumoCobrancaRestaurante, gerarPixMensalidade: gerarPixMensalidadeSaas } = require("../services/saasBillingService");
const path = require("path");
const fs = require("fs");
require("dotenv").config();
const { queryWithRetry } = require("../lib/mysqlRetry");
const perfilCache = new Map();

function parseJsonSafe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}


// Gerar token JWT
const gerarToken = (id, sessaoVersao = 1) => {
  return jwt.sign({ id, sessaoVersao: Number(sessaoVersao || 1) }, process.env.JWT_SECRET, { expiresIn: "7d" });
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

  if (Object.prototype.hasOwnProperty.call(out, "tempoAutoCancelamentoVitrineMin")) {
    const n = Number(out.tempoAutoCancelamentoVitrineMin);
    out.tempoAutoCancelamentoVitrineMin = Number.isFinite(n) ? Math.min(6, Math.max(1, Math.round(n))) : undefined;
  }
  if (out.tempoAutoCancelamentoVitrineMin === undefined) delete out.tempoAutoCancelamentoVitrineMin;

  return out;
}


// helper: calcula flags públicas consistentes

function normalizeSlugIdentificador(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function ensureSlugDisponivel(slug, restauranteIdAtual) {
  if (!slug) return;
  const existente = await Restaurante.findOne({ slugIdentificador: slug });
  if (existente && String(existente._id || existente.id) !== String(restauranteIdAtual)) {
    const err = new Error("Este slug já está em uso por outro restaurante.");
    err.statusCode = 409;
    throw err;
  }
}

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
      const { nome, email, senha, cnpj, localizacao, contaBancaria, slugIdentificador } = req.body;

      const restauranteExistente = await Restaurante.findOne({ email });
      if (restauranteExistente) {
        return res.status(400).json({ mensagem: "Email já cadastrado." });
      }

      const slugNormalizado = normalizeSlugIdentificador(slugIdentificador || nome);
      await ensureSlugDisponivel(slugNormalizado, null);

      const senhaHash = await bcrypt.hash(senha, 10);
      // const recipient_id = await criarRecipient({ nome, cnpj, contaBancaria });

      const novoRestaurante = await Restaurante.create({
        nome,
        email,
        senha: senhaHash,
        cnpj,
        slugIdentificador: slugNormalizado,
        localizacao,
        plano: "free",
        statusAssinatura: "ativo",
        // recipient_id,
      });

      const token = gerarToken(novoRestaurante._id, novoRestaurante.sessaoVersao || 1);
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

      const hojeLogin = new Date(); hojeLogin.setHours(0,0,0,0);
      const fimPlanoLogin = restaurante?.dataFimPlano ? new Date(restaurante.dataFimPlano) : null;
      const licencaVencidaLogin = fimPlanoLogin && !isNaN(fimPlanoLogin.getTime()) && fimPlanoLogin < hojeLogin;

      if (licencaVencidaLogin) {
        const assinaturaCobranca = await resumoCobrancaRestaurante(restaurante).catch(() => null);
        return res.status(403).json({
          mensagem: "Licença vencida. Regularize o plano para continuar usando o Movyo.",
          code: "LICENCA_VENCIDA",
          restauranteId: String(restaurante._id || restaurante.id || ""),
          assinaturaCobranca,
        });
      }

      if (restaurante?.ativo === false || restaurante?.bloqueado === true || String(restaurante?.statusAssinatura || '').toLowerCase() === 'bloqueado') {
        return res.status(403).json({
          mensagem: "Restaurante bloqueado/desativado. Fale com o suporte Movyo.",
          code: "RESTAURANTE_BLOQUEADO",
        });
      }

      const token = gerarToken(restaurante._id, restaurante.sessaoVersao || 1);
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

      const cacheMs = Number(process.env.RESTAURANTE_ME_CACHE_MS || 5000);
      const cached = perfilCache.get(restauranteId);
      if (cached && Date.now() - cached.ts < cacheMs) return res.json({ ...cached.payload, cache: true });

      const [rows] = await queryWithRetry(
        `SELECT id, nome, email, cnpj, telefone, enderecoCep, enderecoRua, enderecoNumero,
                enderecoBairro, enderecoCidade, enderecoEstado, logoUrl, logoSlug, slugIdentificador,
                horariosFuncionamento, tempoMedioEntregaMin, tempoAutoCancelamentoVitrineMin, maxPedidosPorEntregador, pedidosPorEntregador,
                anotaaiStatus, anotaaiUrl, anotaaiIdentificador, anotaaiToken,
                ifoodStatus, ifoodIdentificador, ifoodPrecisaConfirmacao, ifoodIgnorarPronto, ifood,
                food99Status, food99MerchantId, food99WebhookToken, food99ClientId, food99ClientSecret, food99BaseUrl, food99,
                localizacao, statusBot, ativo, mensagensPersonalizadas, chavePix, recipient_id,
                mercadoPago, pagamentoCartaoAtivo, taxaCartaoCreditoAvistaPercent,
                taxaConvenienciaPix, descontoMensalidadePercentual, valorMensalidadeCustomizado, garcons,
                plano, statusAssinatura, dataInicioPlano, dataFimPlano, observacaoPlano,
                dataCadastro, created_at, updated_at
           FROM restaurantes
          WHERE id = ?
          LIMIT 1`,
        [restauranteId],
        { label: 'restaurantes.me' }
      );
      const restaurante = rows?.[0];
      if (!restaurante) {
        return res.status(404).json({ mensagem: "Restaurante não encontrado." });
      }

      const parse = parseJsonSafe;
      const payload = {
        id: restaurante.id,
        _id: restaurante.id,
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
        horariosFuncionamento: parse(restaurante.horariosFuncionamento, {}),
        tempoMedioEntregaMin: restaurante.tempoMedioEntregaMin ?? 45,
        tempoAutoCancelamentoVitrineMin: Number(restaurante.tempoAutoCancelamentoVitrineMin ?? 6),
        maxPedidosPorEntregador: restaurante.maxPedidosPorEntregador ?? restaurante.pedidosPorEntregador ?? 3,
        pedidosPorEntregador: restaurante.pedidosPorEntregador ?? restaurante.maxPedidosPorEntregador ?? 3,
        anotaaiStatus: restaurante.anotaaiStatus === 1 || restaurante.anotaaiStatus === true,
        anotaaiUrl: restaurante.anotaaiUrl || "",
        anotaaiIdentificador: restaurante.anotaaiIdentificador || "",
        anotaaiToken: restaurante.anotaaiToken || "",
        ifoodStatus: restaurante.ifoodStatus === 1 || restaurante.ifoodStatus === true,
        ifoodIdentificador: restaurante.ifoodIdentificador || "",
        ifoodPrecisaConfirmacao: restaurante.ifoodPrecisaConfirmacao === 1 || restaurante.ifoodPrecisaConfirmacao === true,
        ifoodIgnorarPronto: restaurante.ifoodIgnorarPronto === 1 || restaurante.ifoodIgnorarPronto === true,
        ifood: parse(restaurante.ifood, {}),
        food99Status: restaurante.food99Status === 1 || restaurante.food99Status === true,
        food99MerchantId: restaurante.food99MerchantId || "",
        food99WebhookToken: restaurante.food99WebhookToken || "",
        food99ClientId: restaurante.food99ClientId || "",
        food99ClientSecret: restaurante.food99ClientSecret || "",
        food99BaseUrl: restaurante.food99BaseUrl || "",
        food99: parse(restaurante.food99, {}),
        localizacao: parse(restaurante.localizacao, null),
        statusBot: parse(restaurante.statusBot, {}),
        ativo: restaurante.ativo !== 0 && restaurante.ativo !== false,
        mensagensPersonalizadas: parse(restaurante.mensagensPersonalizadas, {}),
        chavePix: restaurante.chavePix || "",
        recipient_id: restaurante.recipient_id || "",
        mercadoPago: parse(restaurante.mercadoPago, {}),
        pagamentoCartaoAtivo: restaurante.pagamentoCartaoAtivo !== 0 && restaurante.pagamentoCartaoAtivo !== false,
        taxaCartaoCreditoAvistaPercent: Number(restaurante.taxaCartaoCreditoAvistaPercent ?? 3.8),
        taxaConvenienciaPix: Number(restaurante.taxaConvenienciaPix ?? 0.5),
        descontoMensalidadePercentual: Number(restaurante.descontoMensalidadePercentual ?? 0),
        valorMensalidadeCustomizado: Number(restaurante.valorMensalidadeCustomizado ?? 0),
        garcons: parse(restaurante.garcons, []),
        plano: restaurante.plano || "free",
        statusAssinatura: restaurante.statusAssinatura || "ativo",
        dataInicioPlano: restaurante.dataInicioPlano || null,
        dataFimPlano: restaurante.dataFimPlano || null,
        observacaoPlano: restaurante.observacaoPlano || "",
        dataCadastro: restaurante.dataCadastro || restaurante.created_at || null,
        createdAt: restaurante.created_at || null,
        updatedAt: restaurante.updated_at || null,
      };

      payload.assinaturaCobranca = await resumoCobrancaRestaurante(payload).catch(() => null);
      perfilCache.set(restauranteId, { ts: Date.now(), payload });
      return res.json(payload);
    } catch (error) {
      console.error("Erro em /api/restaurantes/me:", error);
      return res.status(500).json({ mensagem: "Erro ao buscar restaurante.", erro: error.message, code: error.code });
    }
  },

  async resumoCobranca(req, res) {
    try {
      const restauranteId = String(req.restauranteId || req.params.restauranteId || req.userId || "");
      if (!restauranteId) return res.status(400).json({ mensagem: "Restaurante nao informado." });
      const resumo = await resumoCobrancaRestaurante(restauranteId);
      if (!resumo) return res.status(404).json({ mensagem: "Restaurante nao encontrado." });
      return res.json(resumo);
    } catch (error) {
      console.error("resumo cobranca:", error);
      return res.status(error.status || 500).json({ mensagem: error.message || "Erro ao buscar cobranca." });
    }
  },

  async gerarPixMensalidade(req, res) {
    try {
      const restauranteId = String(req.restauranteId || req.params.restauranteId || req.userId || "");
      if (!restauranteId) return res.status(400).json({ mensagem: "Restaurante nao informado." });
      const result = await gerarPixMensalidadeSaas(restauranteId);
      perfilCache.delete(restauranteId);
      return res.json({
        ok: true,
        reused: !!result.reused,
        cobranca: result.cobranca,
        resumo: result.resumo,
      });
    } catch (error) {
      console.error("gerar pix mensalidade:", error?.response?.data || error);
      return res.status(error.status || error?.response?.status || 500).json({
        mensagem: error?.response?.data?.message || error.message || "Erro ao gerar Pix da mensalidade.",
        erro: error?.response?.data || error.message,
      });
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

      if (Object.prototype.hasOwnProperty.call(dadosAtualizados, "slugIdentificador")) {
        dadosAtualizados.slugIdentificador = normalizeSlugIdentificador(dadosAtualizados.slugIdentificador);
        if (!dadosAtualizados.slugIdentificador) {
          return res.status(400).json({ mensagem: "Informe um slug válido para a vitrine." });
        }
        await ensureSlugDisponivel(dadosAtualizados.slugIdentificador, restauranteId);
      }

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
      return res.status(error.statusCode || 500).json({ mensagem: error.message || "Erro ao atualizar configurações." });
    }
  },



  // GET /api/restaurantes/og/:slug
  // Dados leves para prévia do WhatsApp/OpenGraph da vitrine pública.
  async ogRestaurante(req, res) {
    try {
      const { slug } = req.params;
      const slugLimpo = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
      if (!slugLimpo) {
        return res.status(400).json({ erro: "Slug inválido." });
      }

      let restaurante = await Restaurante.findOne({
        $or: [
          { slugIdentificador: slugLimpo },
          { logoSlug: slugLimpo },
          { _id: slugLimpo },
          { id: slugLimpo },
        ],
      });

      if (!restaurante) {
        restaurante = await Restaurante.findOne({
          $or: [
            { slugIdentificador: { $regex: `^${slugLimpo}$`, $options: "i" } },
            { logoSlug: { $regex: `^${slugLimpo}$`, $options: "i" } },
          ],
        });
      }

      if (!restaurante) {
        return res.status(404).json({ erro: "Restaurante não encontrado.", slug: slugLimpo });
      }

      const nome = String(restaurante.nome || "Restaurante").trim();
      const bairro = String(restaurante.enderecoBairro || "").trim();
      const cidade = String(restaurante.enderecoCidade || "").trim();
      const local = [bairro, cidade].filter(Boolean).join(" • ");
      const descricao = local
        ? `${local} — Peça online pelo cardápio digital.`
        : `Peça online pelo cardápio digital do ${nome}.`;

      return res.json({
        restaurante: {
          _id: restaurante._id,
          nome,
          slugIdentificador: restaurante.slugIdentificador || slugLimpo,
          logoUrl: restaurante.logoUrl || "",
          logoSlug: restaurante.logoSlug || "",
          enderecoBairro: restaurante.enderecoBairro || "",
          enderecoCidade: restaurante.enderecoCidade || "",
          descricao,
        },
      });
    } catch (err) {
      console.error("Erro ao buscar OG do restaurante:", err);
      return res.status(500).json({ erro: "Erro interno." });
    }
  },

  // GET /api/restaurantes/:slug
  async restauranteSlug(req, res) {
    try {
      const { slug } = req.params;
      const slugLimpo = String(slug || "").trim();

      // Compatibilidade da vitrine: aceita slugIdentificador, logoSlug, _id/id
      // e também uma busca case-insensitive para evitar 404 quando o slug foi salvo
      // com maiúsculas/minúsculas diferentes no banco.
      let restaurante = await Restaurante.findOne({
        $or: [
          { slugIdentificador: slugLimpo },
          { logoSlug: slugLimpo },
          { _id: slugLimpo },
          { id: slugLimpo },
        ],
      });

      if (!restaurante) {
        restaurante = await Restaurante.findOne({
          $or: [
            { slugIdentificador: { $regex: `^${slugLimpo}$`, $options: "i" } },
            { logoSlug: { $regex: `^${slugLimpo}$`, $options: "i" } },
          ],
        });
      }

      if (!restaurante) {
        return res.status(404).json({ erro: "Restaurante não encontrado.", slug: slugLimpo });
      }

      const categorias = await CategoriaProduto.find({
        restaurante: restaurante._id,
        ativa: true,
      }).sort({ ordem: 1 });

      const produtosBase = await Produto.find({
        restaurante: restaurante._id,
        ativo: true,
      });
      // ✅ Vitrine pública só mostra produtos liberados na vitrine.
      // Produtos antigos sem ativoVitrine continuam visíveis por compatibilidade.
      const produtos = (produtosBase || []).filter((p) => p.ativoVitrine !== false);

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

            destaque: isProdutoDestaque(p),
            ordem: p.ordem || 0,

            sabores: p.sabores?.length ? p.sabores : (saboresDisponiveis || []),
            bordas: p.bordas?.length ? p.bordas : (bordasDisponiveis || []),
            adicionais: p.adicionais?.length ? p.adicionais : (adicionaisDisponiveis || []),
            complementos: p.complementos?.length
              ? p.complementos
              : (complementosDisponiveis || []),

            extras: p.extras || {},
            ativo: p.ativo,
            ativoVitrine: p.ativoVitrine !== false,

            tipoItem: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") ? "pizza" : "comum",
            categoriaType: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") ? "pizza" : "simple_item",
            pizzaMultisabor: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") && (Boolean(p.pizzaMultisabor) || Number(p.maxSabores || 0) > 1 || (!p.tipoItem && Boolean(pizzaMultisabor))),
            calculoPrecoPor: p.calculoPrecoPor || calculoPrecoPor || "maior",
            tiposExtras: tiposExtras || [],
            maxSabores: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") ? (Number(p.maxSabores || 0) || maxSabores) : 1,
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

      const produtosBase = await Produto.find({ restaurante: restaurante._id, ativo: true });
      const produtos = (produtosBase || []).filter((p) => p.ativoVitrine !== false);

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

            destaque: isProdutoDestaque(p),
            ordem: p.ordem || 0,

            sabores: p.sabores?.length ? p.sabores : (saboresDisponiveis || []),
            bordas: p.bordas?.length ? p.bordas : (bordasDisponiveis || []),
            adicionais: p.adicionais?.length ? p.adicionais : (adicionaisDisponiveis || []),
            complementos: p.complementos?.length
              ? p.complementos
              : (complementosDisponiveis || []),

            extras: p.extras || {},
            ativo: p.ativo,
            ativoVitrine: p.ativoVitrine !== false,

            tipoItem: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") ? "pizza" : "comum",
            categoriaType: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") ? "pizza" : "simple_item",
            pizzaMultisabor: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") && (Boolean(p.pizzaMultisabor) || Number(p.maxSabores || 0) > 1 || (!p.tipoItem && Boolean(pizzaMultisabor))),
            calculoPrecoPor: p.calculoPrecoPor || calculoPrecoPor || "maior",
            tiposExtras: tiposExtras || [],
            maxSabores: String(p.tipoItem || p.tipo || tipoCategoria).toLowerCase().includes("pizza") ? (Number(p.maxSabores || 0) || maxSabores) : 1,
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
