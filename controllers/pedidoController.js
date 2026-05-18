// controllers/pedidoController.js
const mongoose = require("../lib/mongoId");
const crypto = require("crypto");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const Pedido = require("../models/Pedido");
const Cliente = require("../models/Cliente");
const Restaurante = require("../models/Restaurante");
const Mesa = require("../models/mesaModel");
const Produto = require("../models/Produto");

const { enviarMensagem } = require("../utils/bot");

/* =========================================================
   HELPERS (gerais + MP)
========================================================= */

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

function safeStr(v, fallback = "") {
  const s = (v ?? "").toString().trim();
  return s || fallback;
}

function canReuseBalcaoPedido(pedido) {
  if (!pedido) return false;
  if (String(pedido.origem || "").toLowerCase() !== "balcao") return false;

  const st = String(pedido.status || "");
  const pend = Number(pedido.valorPendente ?? 0);

  // ✅ só reaproveita pedido realmente aberto
  return st === "aguardando_pagamento" && pend > 0.00001;
}

function sumPagamentosConfirmados(pedido) {
  const arr = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];
  return round2(
    arr
      .filter((p) => String(p.status || "").toLowerCase() === "confirmado")
      .reduce((acc, p) => acc + (Number(p.valor) || 0), 0)
  );
}

function recalcularTotaisPedido(pedido) {
  const total = round2(Number(pedido?.valorTotal || 0));

  const pagosConfirmados = (pedido?.pagamentos || [])
    .filter((p) => String(p?.status || "").toLowerCase() === "confirmado")
    .reduce((acc, p) => acc + Number(p?.valor || 0), 0);

  const valorPago = round2(pagosConfirmados);
  const valorPendente = round2(Math.max(0, total - valorPago));

  pedido.valorPago = valorPago;
  pedido.valorPendente = valorPendente;

  return { valorPago, valorPendente, total };
}

function aplicarStatusPorPagamentoTotal(pedido) {
  const { valorPendente, total } = recalcularTotaisPedido(pedido);

  const stAtual = String(pedido.status || "");
  const statusIrreversivel = ["em_producao", "em_entrega", "entregue", "cancelado"].includes(
    stAtual
  );

  if (total <= 0) return pedido;

  if (valorPendente <= 0) {
    if (!pedido.pagoEm) pedido.pagoEm = new Date();

    // ✅ ao quitar, vai pra produção
    pedido.status = "em_producao";
    pedido.statusPagamento = "pago";

    const metodos = Array.from(
      new Set(
        (pedido.pagamentos || [])
          .filter((p) => String(p.status || "").toLowerCase() === "confirmado")
          .map((p) => String(p.metodo || "").toLowerCase())
          .filter(Boolean)
      )
    );

    pedido.formadePagamento =
      metodos.length > 1 ? "misto" : metodos[0] || pedido.formadePagamento || "pendente";

    return pedido;
  }

  // ❗ pendente > 0
  pedido.statusPagamento = "pendente";

  // ✅ não deixa “voltar” status se já está em produção/entrega
  if (!statusIrreversivel) {
    pedido.status = "aguardando_pagamento";
  }

  const metodos = Array.from(
    new Set((pedido.pagamentos || []).map((p) => String(p.metodo || "").toLowerCase()).filter(Boolean))
  );

  pedido.formadePagamento =
    metodos.length > 1 ? "misto" : metodos[0] || pedido.formadePagamento || "pendente";

  return pedido;
}

function calcUnitPriceFromItem(it) {
  const quantity = Number(it?.quantidade ?? it?.quantity ?? 1) || 1;

  if (it?.precoUnitario != null) return round2(Number(it.precoUnitario));
  if (it?.precoTotal != null) return round2(Number(it.precoTotal) / quantity);
  if (it?.amount != null) return round2(Number(it.amount) / 100 / quantity);

  return 0;
}

/**
 * statement_descriptor:
 * - máximo 22 caracteres
 * - geralmente: A-Z 0-9 e espaço
 */
function toStatementDescriptor(input) {
  const raw = String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || "MOVYO DELIVERY").slice(0, 22);
}

function extractMpError(err) {
  const mp = err?.response?.data || err?.cause || err?.message || err;

  if (mp && typeof mp === "object") {
    return {
      message: mp?.message || mp?.error || undefined,
      error: mp?.error || undefined,
      status: mp?.status || undefined,
      status_code: mp?.status_code || undefined,
      cause: mp?.cause || mp?.causes || undefined,
      id: mp?.id || undefined,
      causes: Array.isArray(mp?.cause)
        ? mp.cause.map((c) => ({ code: c?.code, description: c?.description }))
        : undefined,
    };
  }

  return { message: String(mp || "Erro Mercado Pago") };
}

function parseEnderecoParaCliente(enderecoCliente, residenciaNumero, residenciaBairro) {
  const raw = safeStr(enderecoCliente, "");
  const numero = safeStr(residenciaNumero, "");
  let bairro = safeStr(residenciaBairro, "");

  let left = raw;
  if (raw.includes(" - ")) {
    const parts = raw.split(" - ");
    left = safeStr(parts[0], raw);
    if (!bairro) bairro = safeStr(parts.slice(1).join(" - "), "");
  }

  let rua = left;
  if (numero) {
    const re = new RegExp(`(,\\s*${numero}|\\s+${numero})$`);
    rua = left.replace(re, "").trim();
  }

  if (!rua) rua = raw;

  return {
    rua: rua || raw,
    numero: numero || "",
    bairro: bairro || "",
  };
}

async function buildMpItemsFromPedidoItens(itens = []) {
  const arr = Array.isArray(itens) ? itens : [];

  const defaultCategory = process.env.MP_DEFAULT_CATEGORY_ID || "others";
  const deliveryCategory = process.env.MP_DELIVERY_CATEGORY_ID || defaultCategory;
  const feeCategory = process.env.MP_FEE_CATEGORY_ID || defaultCategory;

  const ids = [
    ...new Set(
      arr
        .map((it) => it?.produtoId)
        .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id))
    ),
  ];

  let produtos = [];
  if (ids.length > 0) {
    produtos = await Produto.find({ _id: { $in: ids } })
      .select("_id nome descricao mercadoPagoCategoryId")
      .lean();
  }

  const mapProdutos = new Map((produtos || []).map((p) => [String(p._id), p]));

  return arr
    .filter(Boolean)
    .map((it) => {
      const quantity = Number(it?.quantidade ?? it?.quantity ?? 1) || 1;
      const unit_price = calcUnitPriceFromItem(it);

      const nomeItem = safeStr(it?.nome || it?.title, "Item");
      const isEntrega = nomeItem.toLowerCase().includes("entrega");
      const isTaxa = nomeItem.toLowerCase().includes("taxa");

      const pid =
        it?.produtoId && mongoose.Types.ObjectId.isValid(String(it.produtoId))
          ? String(it.produtoId)
          : null;

      const prod = pid ? mapProdutos.get(pid) : null;

      const title = safeStr(prod?.nome, nomeItem);
      const description = safeStr(prod?.descricao, safeStr(it?.descricao || it?.description, title));

      const category_id =
        safeStr(prod?.mercadoPagoCategoryId, "") ||
        safeStr(it?.category_id, "") ||
        (isEntrega ? deliveryCategory : isTaxa ? feeCategory : defaultCategory);

      return {
        id: safeStr(pid || it?._id || it?.id || it?.sku || nomeItem, "item"),
        title,
        description,
        category_id,
        quantity,
        unit_price: round2(unit_price),
      };
    })
    .filter((i) => i.unit_price > 0 && i.quantity > 0);
}

/* =========================================================
   REGRAS DO BALCÃO (compat pagamento parcial)
========================================================= */
function isOrigemBalcao(origem) {
  return String(origem || "").toLowerCase() === "balcao";
}

function normalizeFormaPagamento(fpRaw) {
  const fp = String(fpRaw || "").toLowerCase().trim();
  const isPix = fp === "pix";
  const isCard = fp === "cartaocredito" || fp === "cartao" || fp === "cartão";
  return { fp, isPix, isCard };
}

/* =========================================================
   ✅ COZINHA: helpers
========================================================= */

// o que é "item de cozinha"?
// - se o item já vem com categoriaType === "cozinha" (melhor)
// - OU se o produto tem imprimeNaCozinha === true
async function isItemDeCozinha(it) {
  const cat = String(it?.categoriaType || "").toLowerCase();
  if (cat === "cozinha") return true;

  const pid = it?.produtoId;
  if (pid && mongoose.Types.ObjectId.isValid(String(pid))) {
    const prod = await Produto.findById(pid).select("imprimeNaCozinha").lean();
    if (prod?.imprimeNaCozinha === true) return true;
  }
  return false;
}

// status por item (valores sugeridos)
const COZINHA_STATUS = {
  PENDENTE: "pendente", // entrou na fila
  PREPARANDO: "preparando", // opcional
  PRONTO: "pronto", // saiu da cozinha
  ENTREGUE_MESA: "entregue_mesa",
  ENTREGUE_CLIENTE: "entregue_cliente",
  CANCELADO: "cancelado",
};

function ensureItemCozinhaState(item) {
  if (!item || typeof item !== "object") return item;

  // ✅ MySQL/JSON: registros antigos podem vir com cozinha ausente, null, string ou boolean.
  // Normaliza sempre para objeto antes de alterar status.
  if (!item.cozinha || typeof item.cozinha !== "object" || Array.isArray(item.cozinha)) {
    item.cozinha = {};
  }

  if (!item.cozinha.status) item.cozinha.status = COZINHA_STATUS.PENDENTE;
  if (!item.cozinha.criadoEm) {
    item.cozinha.criadoEm = item.criadoEm || item.createdAt || item.adicionadoEm || new Date();
  }
  return item;
}

// aplica estado inicial pra itens que já vêm marcados como cozinha no payload
function seedCozinhaOnItens(itens) {
  const arr = Array.isArray(itens) ? itens : [];
  for (const it of arr) {
    const cat = String(it?.categoriaType || "").toLowerCase();
    if (cat === "cozinha") ensureItemCozinhaState(it);
  }
  return arr;
}

/* =========================================================
   CRIAR PEDIDO (balcão ou vitrine/salão)
========================================================= */
const criarPedido = async (req, res) => {
  console.log("🟠 Criando pedido com status:", req.body.status);

  const {
    restaurante,
    numeroPedido,
    nomeCliente,
    telefoneCliente,
    enderecoCliente,
    residenciaNumero,
    residenciaComplemento,
    residenciaReferencia,
    residenciaBairro,
    residenciaCep,
    itens,
    valorTotal,
    formadePagamento,
    descricaoPedido,
    motoristaId,
    latitudeCliente,
    longitudeCliente,
    clienteEmail,
    mpCard,
  } = req.body;

  const origem = (req.body.origem || "balcao").toLowerCase();

  if (!restaurante) {
    return res.status(400).json({ message: "Restaurante é obrigatório." });
  }

  try {
    const telefoneNormalizado = (telefoneCliente || "").replace(/\D/g, "");
    const restauranteDoc = await Restaurante.findById(restaurante);

    if (!restauranteDoc) {
      return res.status(404).json({ message: "Restaurante não encontrado." });
    }

    const mpConectado =
      !!restauranteDoc.mercadoPago?.conectado && !!restauranteDoc.mercadoPago?.accessToken;

    const totalNumber = Number(String(valorTotal).replace(",", "."));
    if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
      return res.status(400).json({ message: "valorTotal inválido." });
    }

    // =========================
    // 1) Salva/atualiza Cliente
    // =========================
    if (telefoneNormalizado) {
      const clienteExistente = await Cliente.findOne({ telefone: telefoneNormalizado });

      const parsedEndereco = parseEnderecoParaCliente(enderecoCliente, residenciaNumero, residenciaBairro);

      const endereco = {
        apelido: origem,
        rua: parsedEndereco.rua,
        numero: parsedEndereco.numero,
        bairro: parsedEndereco.bairro,
        cidade: "Olinda",
        estado: "PE",
        cep: residenciaCep,
      };

      if (clienteExistente) {
        const enderecoExiste = clienteExistente.enderecos?.some(
          (e) => e.rua === endereco.rua && e.numero === endereco.numero
        );

        if (!enderecoExiste) {
          clienteExistente.enderecos.push(endereco);
          await clienteExistente.save();
        }
      } else {
        await new Cliente({
          nome: nomeCliente || "Cliente",
          telefone: telefoneNormalizado,
          enderecos: [endereco],
        }).save();
      }
    }

    // =========================
    // 2) Entregador (se existir)
    // =========================
    const entregadorObjectId =
      motoristaId && mongoose.Types.ObjectId.isValid(motoristaId)
        ? new mongoose.Types.ObjectId(motoristaId)
        : null;

    // =========================
    // 3) Gera número do pedido
    // =========================
    let novoNumeroPedido = numeroPedido;

    if (!numeroPedido) {
      const prefixos = {
        ifood: "IF",
        balcao: "BK",
        bot: "BT",
        vitrine: "BT",
        salao: "SL",
        salao_garcom: "SL",
        salao_mesa: "MS",
        salaoMesa: "MS",
        sala: "SL",
        // compat
        salao_: "SL",
      };

      const prefixo = prefixos[origem] || "BT";
      const regex = new RegExp(`${prefixo}(\\d+)`);

      const ultimo = await Pedido.findOne({ origem, restaurante }).sort({ criadoEm: -1 });
      const ultimoNumero = ultimo?.numeroPedido?.match(regex)?.[1] || "0";
      const novoNumero = String(Number(ultimoNumero) + 1).padStart(5, "0");
      novoNumeroPedido = `${prefixo}${novoNumero}`;
    }

    // =========================
    // 4) Cria pedido base
    // =========================
    const { isPix, isCard } = normalizeFormaPagamento(formadePagamento);
    const isBalcao = isOrigemBalcao(origem);

    const statusInicial = isBalcao
      ? "aguardando_pagamento"
      : isPix || isCard
      ? "aguardando_pagamento"
      : "em_producao";

    const itensSeed = seedCozinhaOnItens(Array.isArray(itens) ? itens : []);

    const novoPedido = new Pedido({
      numeroPedido: novoNumeroPedido,
      nomeCliente,
      telefoneCliente: telefoneNormalizado,
      enderecoCliente,
      residenciaNumero,
      residenciaComplemento,
      residenciaReferencia,
      residenciaBairro,
      residenciaCep,
      itens: itensSeed,
      valorTotal: round2(totalNumber),

      // ✅ balcão (e geral) inicia SEM PAGAMENTO
      valorPago: 0,
      valorPendente: round2(totalNumber),

      formadePagamento: formadePagamento || "pendente",
      descricaoPedido,
      restaurante,
      entregador: entregadorObjectId,
      latitudeCliente,
      longitudeCliente,
      origem,

      status: statusInicial,

      pagamentos: [],
    });

    await novoPedido.save();

    // =========================================================
    // ✅ BALCÃO: encerra aqui
    // =========================================================
    if (isBalcao) {
      req.io?.to(`restaurante-${restaurante}`).emit("novoPedido", novoPedido);
      return res.status(201).json({
        pedidoId: novoPedido._id,
        numeroPedido: novoPedido.numeroPedido,
        status: novoPedido.status,
        origem: novoPedido.origem,
        valorTotal: novoPedido.valorTotal,
        valorPago: novoPedido.valorPago,
        valorPendente: novoPedido.valorPendente,
        message:
          "Pedido criado (balcão). Pagamento parcial/misto deve ser registrado via pagamentos[].",
      });
    }

    // =========================================================
    // ✅ VITRINE/SALÃO: fluxo antigo (PIX/CARTÃO cria cobrança)
    // =========================================================

    // =========================
    // 5) PIX (Mercado Pago)
    // =========================
    if (isPix) {
      if (!mpConectado) {
        await Pedido.findByIdAndUpdate(novoPedido._id, { $set: { status: "cancelado" } });
        return res.status(400).json({ message: "Restaurante não conectado ao Mercado Pago (OAuth)." });
      }

      const fee = Number(process.env.MP_PLATFORM_FEE || 0.5);
      const desc = `Pedido ${novoPedido.numeroPedido} - ${restauranteDoc.nome}`;

      const client = new MercadoPagoConfig({
        accessToken: restauranteDoc.mercadoPago.accessToken,
      });
      const payment = new Payment(client);

      const mpItems = await buildMpItemsFromPedidoItens(itensSeed);

      const payerEmail =
        clienteEmail ||
        process.env.MP_TEST_PAYER_EMAIL ||
        (telefoneNormalizado ? `cliente_${telefoneNormalizado}@example.com` : "comprador@movyo.com");

      const notificationUrl = process.env.API_PUBLIC_URL
        ? `${process.env.API_PUBLIC_URL}/api/webhooks/mercadopago`
        : null;

      const idempotencyKey = `pedido-${novoPedido._id}-pix`;

      try {
        const pagamento = await payment.create(
          {
            body: {
              transaction_amount: round2(totalNumber),
              description: desc,
              payment_method_id: "pix",
              payer: { email: payerEmail },
              ...(mpItems.length > 0 ? { additional_info: { items: mpItems } } : {}),
              application_fee: fee,
              external_reference: novoPedido._id.toString(),
              ...(notificationUrl ? { notification_url: notificationUrl } : {}),
            },
          },
          { idempotencyKey }
        );

        const tx = pagamento?.point_of_interaction?.transaction_data;

        novoPedido.mpPaymentId = pagamento?.id ? String(pagamento.id) : null;
        novoPedido.statusPagamento = pagamento?.status || "pending";
        novoPedido.mpStatusDetail = pagamento?.status_detail || null;

        novoPedido.pixQrCode = tx?.qr_code || "";
        novoPedido.pixQrCodeBase64 = tx?.qr_code_base64 || "";

        novoPedido.splitInfo = {
          plataformaFee: fee,
          marketplaceSellerId: restauranteDoc.mercadoPago.userId || null,
        };

        await novoPedido.save();

        req.io?.to(`restaurante-${restaurante}`).emit("novoPedido", novoPedido);

        return res.status(201).json({
          pedidoId: novoPedido._id,
          numeroPedido: novoPedido.numeroPedido,
          status: novoPedido.status,
          statusPagamento: novoPedido.statusPagamento,
          pix_qr_code: novoPedido.pixQrCode,
          pix_qr_code_base64: novoPedido.pixQrCodeBase64,
        });
      } catch (err) {
        const mp = extractMpError(err);
        console.error("❌ MP PIX ERROR:", mp);

        await Pedido.findByIdAndUpdate(novoPedido._id, {
          $set: { status: "cancelado", statusPagamento: "error", mpError: mp },
        }).catch(() => {});

        return res.status(400).json({
          message: "Falha ao criar pagamento Pix (Mercado Pago).",
          mp,
        });
      }
    }

    // =========================
    // 5B) CARTÃO (Mercado Pago)
    // =========================
    if (isCard) {
      if (!mpConectado) {
        await Pedido.findByIdAndUpdate(novoPedido._id, { $set: { status: "cancelado" } });
        return res.status(400).json({ message: "Restaurante não conectado ao Mercado Pago (OAuth)." });
      }

      if (!mpCard?.token || !mpCard?.payment_method_id) {
        await Pedido.findByIdAndUpdate(novoPedido._id, { $set: { status: "cancelado" } });
        return res.status(400).json({
          message: "Dados do cartão ausentes (token/payment_method_id).",
        });
      }

      const fee = Number(process.env.MP_PLATFORM_FEE || 0.5);
      const desc = `Pedido ${novoPedido.numeroPedido} - ${restauranteDoc.nome}`;

      const statementDescriptor = toStatementDescriptor(
        process.env.MP_STATEMENT_DESCRIPTOR || restauranteDoc?.nome || "MOVYO DELIVERY"
      );

      const client = new MercadoPagoConfig({
        accessToken: restauranteDoc.mercadoPago.accessToken,
      });
      const payment = new Payment(client);

      const mpItems = await buildMpItemsFromPedidoItens(itensSeed);

      const payerEmail =
        mpCard?.payer?.email || clienteEmail || process.env.MP_TEST_PAYER_EMAIL || "comprador@movyo.com";

      const payerIdentification = mpCard?.payer?.identification || undefined;

      const notificationUrl = process.env.API_PUBLIC_URL
        ? `${process.env.API_PUBLIC_URL}/api/webhooks/mercadopago`
        : null;

      const idempotencyKey = `pedido-${novoPedido._id}-cc`;

      try {
        const pagamento = await payment.create(
          {
            body: {
              transaction_amount: round2(totalNumber),
              description: desc,
              statement_descriptor: statementDescriptor,
              token: String(mpCard.token),
              payment_method_id: String(mpCard.payment_method_id),
              issuer_id: mpCard.issuer_id ? String(mpCard.issuer_id) : undefined,
              installments: 1,
              payer: {
                email: payerEmail,
                ...(payerIdentification ? { identification: payerIdentification } : {}),
              },
              ...(mpItems.length > 0 ? { additional_info: { items: mpItems } } : {}),
              application_fee: fee,
              external_reference: novoPedido._id.toString(),
              ...(notificationUrl ? { notification_url: notificationUrl } : {}),
            },
          },
          { idempotencyKey }
        );

        novoPedido.mpPaymentId = pagamento?.id ? String(pagamento.id) : null;
        novoPedido.statusPagamento = pagamento?.status || null;
        novoPedido.mpStatusDetail = pagamento?.status_detail || null;

        novoPedido.formadePagamento = "cartao";

        novoPedido.splitInfo = {
          plataformaFee: fee,
          marketplaceSellerId: restauranteDoc.mercadoPago.userId || null,
        };

        const st = String(pagamento?.status || "").toLowerCase();

        if (st === "approved" || st === "paid") {
          const agora = new Date();

          novoPedido.pagamentos = Array.isArray(novoPedido.pagamentos) ? novoPedido.pagamentos : [];
          novoPedido.pagamentos.push({
            metodo: "cartao",
            valor: round2(totalNumber),
            status: "confirmado",
            recebidoEm: agora,
            recebidoPor: null,
            recebidoPorRole: "restaurante",
            obs: "Cartão Mercado Pago",
            mpPaymentId: novoPedido.mpPaymentId,
            mpStatus: st,
            confirmadoEm: agora,
          });

          novoPedido.valorPago = round2(totalNumber);
          novoPedido.valorPendente = 0;

          novoPedido.status = "em_producao";
          novoPedido.statusPagamento = "pago";
          if (!novoPedido.pagoEm) novoPedido.pagoEm = agora;
        } else {
          novoPedido.status = "aguardando_pagamento";
          novoPedido.statusPagamento = "pendente";
        }

        await novoPedido.save();

        req.io?.to(`restaurante-${restaurante}`).emit("novoPedido", novoPedido);

        return res.status(201).json({
          pedidoId: novoPedido._id,
          numeroPedido: novoPedido.numeroPedido,
          status: novoPedido.status,
          statusPagamento: novoPedido.statusPagamento,
          mpPaymentId: novoPedido.mpPaymentId,
          mpStatusDetail: novoPedido.mpStatusDetail || undefined,
        });
      } catch (err) {
        const mp = extractMpError(err);
        console.error("❌ MP CARD ERROR:", mp);

        await Pedido.findByIdAndUpdate(novoPedido._id, {
          $set: { status: "cancelado", statusPagamento: "error", mpError: mp },
        }).catch(() => {});

        return res.status(400).json({
          message: "Falha ao processar cartão (Mercado Pago).",
          mp,
        });
      }
    }

    // =========================
    // 6) Pedido normal (sem MP)
    // =========================
    req.io?.to(`restaurante-${restaurante}`).emit("novoPedido", novoPedido);
    return res.status(201).json({ _id: novoPedido._id });
  } catch (error) {
    console.error("Erro ao criar pedido:", error);
    return res.status(500).json({
      message: "Erro ao criar pedido",
      error: error.message,
    });
  }
};

/* =========================================================
   LISTAR PEDIDOS POR RESTAURANTE
========================================================= */
const listarPedidosPorRestaurante = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    const { status, origem, somenteMesa, somenteBalcao, page = 1, limit = 200, dataInicio, dataFim } =
      req.query;

    const query = { restaurante: restauranteId };

    if (status) query.status = status;
    if (origem) query.origem = origem;

    if (somenteMesa === "true") query.mesaId = { $ne: null };
    if (somenteBalcao === "true") query.mesaId = null;

    if (dataInicio || dataFim) {
      const inicio = dataInicio ? new Date(`${dataInicio}T00:00:00.000Z`) : null;
      const fim = dataFim ? new Date(`${dataFim}T23:59:59.999Z`) : null;

      query.$and = query.$and || [];

      const dateFilter = {};
      if (inicio) dateFilter.$gte = inicio;
      if (fim) dateFilter.$lte = fim;

      query.$and.push({
        $or: [{ createdAt: dateFilter }, { criadoEm: dateFilter }],
      });
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(500, Math.max(1, Number(limit) || 200));
    const skip = (pageNum - 1) * limitNum;

    const [total, pedidos] = await Promise.all([
      Pedido.countDocuments(query),
      Pedido.find(query)
        .populate("entregador")
        .sort({ createdAt: -1, criadoEm: -1 })
        .skip(skip)
        .limit(limitNum),
    ]);

    res.json({ total, page: pageNum, limit: limitNum, pedidos });
  } catch (error) {
    console.error("Erro ao buscar pedidos:", error);
    res.status(500).json({
      message: "Erro ao buscar pedidos",
      error: error.message,
    });
  }
};

/* =========================================================
   ✅ COZINHA: LISTAR FILA (itens achatados)
========================================================= */
const listarFilaCozinha = async (req, res) => {
  const { restauranteId } = req.params;

  try {
    // status que podem conter itens "ativos" de cozinha
    const pedidos = await Pedido.find({
      restaurante: restauranteId,
      status: { $in: ["em_producao", "em_entrega", "aguardando_resposta", "em_rota"] },
    })
      .select("numeroPedido origem mesaId status criadoEm createdAt itens nomeCliente")
      .sort({ createdAt: -1, criadoEm: -1 })
      .lean();

    const fila = [];
    for (const p of pedidos) {
      const itens = Array.isArray(p.itens) ? p.itens : [];
      for (let idx = 0; idx < itens.length; idx++) {
        const it = itens[idx];
        const ok = await isItemDeCozinha(it);
        if (!ok) continue;

        const cozinha = it?.cozinha || {};
        const st = String(cozinha?.status || COZINHA_STATUS.PENDENTE);

        // não mostra finalizados
        if (
          [COZINHA_STATUS.ENTREGUE_MESA, COZINHA_STATUS.ENTREGUE_CLIENTE, COZINHA_STATUS.CANCELADO].includes(
            st
          )
        ) {
          continue;
        }

        // prioridade automática:
        // - se for mesa ou entrega => prioridade
        const isMesa = !!p.mesaId;
        const isEntrega = String(p.status || "") === "em_entrega";
        const prioridade = isMesa || isEntrega;

        const criado = p.createdAt || p.criadoEm || new Date();
        const minutos = Math.max(0, Math.floor((Date.now() - new Date(criado).getTime()) / 60000));

        fila.push({
          pedidoId: String(p._id),
          numeroPedido: p.numeroPedido,
          origem: p.origem,
          statusPedido: p.status,
          mesaId: p.mesaId ? String(p.mesaId) : null,
          cliente: p.nomeCliente || "",
          tempoMin: minutos,
          tempoSeg: Math.max(0, Math.floor((Date.now() - new Date(cozinha?.criadoEm || criado).getTime()) / 1000)),
          criadoEm: cozinha?.criadoEm || criado,

          itemIndex: idx,
          item: {
            nome: it.nome,
            produtoId: it.produtoId || null,
            quantidade: it.quantidade || 1,
            observacao: it.observacao || "",
            categoriaType: it.categoriaType || "",
          },

          cozinha: {
            status: st,
            criadoEm: cozinha?.criadoEm || criado,
            prontoEm: cozinha?.prontoEm || null,
            entregueEm: cozinha?.entregueEm || null,
          },

          prioridade,
        });
      }
    }

    // ordena: prioridade primeiro, depois mais antigo (tempo maior), depois número
    fila.sort((a, b) => {
      if (a.prioridade !== b.prioridade) return a.prioridade ? -1 : 1;
      if (a.tempoMin !== b.tempoMin) return b.tempoMin - a.tempoMin;
      return String(a.numeroPedido || "").localeCompare(String(b.numeroPedido || ""));
    });

    return res.json({ ok: true, total: fila.length, fila });
  } catch (error) {
    console.error("Erro ao listar fila cozinha:", error);
    return res.status(500).json({ message: "Erro ao listar fila da cozinha.", error: error.message });
  }
};

/* =========================================================
   ✅ COZINHA: atualizar status por item
========================================================= */
async function atualizarStatusItemCozinha(req, res, nextStatus) {
  try {
    // A rota atual usa :itemId, versões anteriores usavam :itemIndex.
    // No MySQL os itens ficam dentro de um JSON array, então aceitamos os dois formatos.
    const { pedidoId } = req.params;
    const itemRef = req.params.itemIndex ?? req.params.itemId ?? req.body?.itemIndex ?? req.body?.itemId;

    if (!mongoose.Types.ObjectId.isValid(String(pedidoId))) {
      return res.status(400).json({ message: "pedidoId inválido." });
    }

    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const itens = Array.isArray(pedido.itens) ? pedido.itens : [];

    let idx = Number(itemRef);
    if (!Number.isInteger(idx) || idx < 0 || idx >= itens.length) {
      const ref = String(itemRef || "").trim();
      idx = itens.findIndex((item) => {
        const ids = [item?._id, item?.id, item?.itemId, item?.produtoId].filter(Boolean).map(String);
        return ids.includes(ref);
      });
    }

    if (!Number.isInteger(idx) || idx < 0 || idx >= itens.length) {
      return res.status(404).json({ message: "Item não encontrado.", itemRef });
    }

    const it = itens[idx];

    // garante objeto
    ensureItemCozinhaState(it);

    const agora = new Date();
    it.cozinha.status = nextStatus;
    it.cozinha.atualizadoEm = agora;

    if (nextStatus === COZINHA_STATUS.PRONTO) it.cozinha.prontoEm = agora;
    if ([COZINHA_STATUS.ENTREGUE_MESA, COZINHA_STATUS.ENTREGUE_CLIENTE].includes(nextStatus)) {
      it.cozinha.entregueEm = agora;
    }

    // ✅ MySQL: persiste o JSON completo usando update direto.
    // Evita qualquer trecho legado de Mongoose, como markModified(), e garante updated_at.
    const pedidoAtualizado = await Pedido.findByIdAndUpdate(
      pedidoId,
      { $set: { itens } },
      { new: true }
    );

    const pedidoPlain = typeof pedido.toObject === "function" ? pedido.toObject() : pedido;
    const pedidoFinal = pedidoAtualizado || { ...pedidoPlain, itens };

    // eventos realtime
    const restauranteSala = String(pedidoFinal.restaurante?._id || pedidoFinal.restaurante || pedido.restaurante?._id || pedido.restaurante || "");
    req.io?.to(`restaurante-${restauranteSala}`).emit("pedidoAtualizado", pedidoFinal);
    req.io?.to(`restaurante-${restauranteSala}`).emit("cozinhaItemAtualizado", {
      pedidoId: String(pedidoFinal._id || pedidoId),
      numeroPedido: pedidoFinal.numeroPedido || pedido.numeroPedido,
      itemIndex: idx,
      status: nextStatus,
    });
    req.io?.to(`restaurante-${restauranteSala}`).emit("filaCozinhaAtualizada", {
      pedidoId: String(pedidoFinal._id || pedidoId),
      itemIndex: idx,
      status: nextStatus,
    });

    return res.json({ ok: true, pedido: pedidoFinal, itemIndex: idx, status: nextStatus });
  } catch (error) {
    console.error("Erro atualizar status item cozinha:", error);
    return res.status(500).json({ message: "Erro ao atualizar item da cozinha.", error: error.message });
  }
}

const marcarItemPronto = (req, res) => atualizarStatusItemCozinha(req, res, COZINHA_STATUS.PRONTO);
const marcarItemEntregueMesa = (req, res) =>
  atualizarStatusItemCozinha(req, res, COZINHA_STATUS.ENTREGUE_MESA);
const marcarItemEntregueCliente = (req, res) =>
  atualizarStatusItemCozinha(req, res, COZINHA_STATUS.ENTREGUE_CLIENTE);

/* =========================================================
   ENVIAR PARA ENTREGADOR
========================================================= */
const enviarParaEntregador = async (req, res) => {
  const { idPedido, idEntregador } = req.params;

  try {
    const pedido = await Pedido.findById(idPedido).populate("restaurante");
    if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado" });

    req.io?.to(`entregador-${idEntregador}`).emit("pedidoRecebido", pedido);
    console.log(`📦 Emitido pedido para sala entregador-${idEntregador}`);

    pedido.entregador = idEntregador;
    pedido.status = "aguardando_resposta";
    await pedido.save();

    res.status(200).json({ sucesso: true, mensagem: "Pedido enviado para o entregador" });
  } catch (err) {
    console.error("❌ Erro ao enviar pedido:", err);
    res.status(500).json({ erro: "Erro ao enviar pedido" });
  }
};

/* =========================================================
   CLIENTE
========================================================= */
const buscarClientePorTelefone = async (req, res) => {
  const { telefone } = req.params;
  try {
    const cliente = await Cliente.findOne({ telefone });
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json(cliente);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar cliente", details: err.message });
  }
};

const criarOuAtualizarCliente = async (req, res) => {
  const { nome, telefone, enderecos = [] } = req.body;

  if (!telefone || !nome || !enderecos.length) {
    return res.status(400).json({
      error: "Nome, telefone e pelo menos um endereço são obrigatórios.",
    });
  }

  try {
    let cliente = await Cliente.findOne({ telefone });

    if (cliente) {
      cliente.nome = nome;

      enderecos.forEach((novo) => {
        const existe = cliente.enderecos.some((e) => e.rua === novo.rua && e.numero === novo.numero);
        if (!existe) cliente.enderecos.push(novo);
      });

      await cliente.save();
      return res.status(200).json({ message: "Cliente atualizado com sucesso", cliente });
    } else {
      const novoCliente = await Cliente.create({ nome, telefone, enderecos });
      return res.status(201).json({ message: "Cliente criado com sucesso", cliente: novoCliente });
    }
  } catch (err) {
    res.status(500).json({ error: "Erro ao salvar cliente", details: err.message });
  }
};

const listarPedidosDoCliente = async (req, res) => {
  const { telefone } = req.params;

  try {
    const pedidos = await Pedido.find({ telefoneCliente: telefone }).sort({ criadoEm: -1 });
    res.status(200).json(pedidos);
  } catch (err) {
    res.status(500).json({ message: "Erro ao buscar pedidos do cliente", error: err.message });
  }
};

/* =========================================================
   STATUS / ACOMPANHAMENTO
========================================================= */
const atualizarStatusPedido = async (req, res) => {
  const { id } = req.params;
  const status = req.body.status || req.body.novoStatus;

  console.log("🟡 Pedido ID recebido:", id);
  console.log("🟡 Novo status recebido:", status);

  if (!status) {
    console.warn("⚠️ Nenhum status enviado no body.");
    return res.status(400).json({ erro: "Status é obrigatório." });
  }

  try {
    const pedido = await Pedido.findById(id).populate("restaurante");
    if (!pedido) {
      console.log(`❌ Pedido não encontrado com ID: ${id}`);
      return res.status(404).json({ erro: "Pedido não encontrado." });
    }

    const statusAnterior = pedido.status;
    pedido.status = status;
    await pedido.save();

    req.io?.to(`restaurante-${pedido.restaurante._id}`).emit("pedidoAtualizado", pedido);
    console.log(`📦 Status atualizado: ${statusAnterior} → ${status}`);

    const telefone = pedido.telefoneCliente;
    const nomeRestaurante = pedido.restaurante?.nome || "nosso restaurante";

    if (telefone && status === "em_producao") {
      try {
        await enviarMensagem(
          pedido.restaurante._id,
          telefone,
          `🍽️ Olá! Seu pedido foi aceito pelo restaurante *${nomeRestaurante}*. Em breve estará a caminho!`
        );
      } catch (e) {
        console.error("❌ Falha ao enviar mensagem em_producao:", e.message);
      }
    }

    if (telefone && status === "em_entrega") {
      try {
        await enviarMensagem(
          pedido.restaurante._id,
          telefone,
          `🛵 O entregador retirou seu pedido da loja! Em breve você receberá o link para acompanhar a entrega em tempo real.`
        );
        req.io?.to(`restaurante-${pedido.restaurante._id}`).emit("pedidoParaEntrega", pedido);
      } catch (e) {
        console.error("❌ Falha ao enviar mensagem em_entrega:", e.message);
      }
    }

    if (telefone && status === "entregue") {
      try {
        await enviarMensagem(pedido.restaurante._id, telefone, `✅ Seu pedido foi entregue! Obrigado pela preferência 🛵`);
      } catch (e) {
        console.error("❌ Falha ao enviar mensagem entregue:", e.message);
      }
    }

    return res.json({ sucesso: true, pedido });
  } catch (error) {
    console.error("❌ Erro geral ao atualizar status:", error);
    return res.status(500).json({
      erro: "Erro interno ao atualizar status",
      detalhes: error.message,
    });
  }
};

const getStatusPedido = async (req, res) => {
  const { id } = req.params;

  try {
    const pedido = await Pedido.findById(id);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });
    return res.json({ status: pedido.status });
  } catch (err) {
    console.error("Erro ao buscar status do pedido:", err);
    return res.status(500).json({ message: "Erro interno ao buscar status." });
  }
};

const obterPedidoPorId = async (req, res) => {
  try {
    const pedido = await Pedido.findById(req.params.id);
    if (!pedido) return res.status(404).json({ error: "Pedido não encontrado" });
    res.json(pedido);
  } catch (err) {
    console.error("Erro ao buscar pedido:", err);
    res.status(500).json({ error: "Erro ao buscar pedido", detalhe: err.message });
  }
};

/* =========================================================
   ENTREGA (link + conclusão)
========================================================= */
async function iniciarEntrega(req, res) {
  const pedido = await Pedido.findById(req.params.id).populate("restaurante");
  if (!pedido) return res.status(404).send("Pedido não encontrado");

  const token = crypto.randomBytes(16).toString("hex");
  const expiracao = Date.now() + 1000 * 60 * 60; // 1h

  pedido.status = "em_entrega";
  pedido.linkEntrega = { token, expiracao };
  await pedido.save();

  req.io?.to(`restaurante-${pedido.restaurante._id}`).emit("pedidoAtualizado", pedido);

  const link = `${process.env.CLIENTE_URL}/acompanhar/${token}`;

  if (pedido.telefoneCliente) {
    await enviarMensagem(
      pedido.restaurante._id,
      pedido.telefoneCliente,
      `🛵 O entregador está a caminho!\nAcompanhe em tempo real: ${link}`
    );
  }

  res.json({ ok: true, link });
}

async function concluirEntrega(req, res) {
  const pedido = await Pedido.findById(req.params.id).populate("restaurante");
  if (!pedido) return res.status(404).send("Pedido não encontrado");

  pedido.status = "entregue";
  await pedido.save();

  req.io?.to(`restaurante-${pedido.restaurante._id}`).emit("pedidoAtualizado", pedido);

  res.json({ ok: true });
}

/* =========================================================
   LISTAR ENTREGADORES COM PEDIDOS ATIVOS (em_entrega)
========================================================= */
async function listarPedidosAtivos(req, res) {
  try {
    const { restauranteId } = req.params;

    const pedidos = await Pedido.find({
      restaurante: restauranteId,
      status: "em_entrega",
      entregador: { $ne: null },
    }).populate("entregador");

    const entregadoresComPedido = pedidos
      .map((p) => p.entregador)
      .filter(Boolean)
      .map((e) => ({
        _id: e._id,
        nome: e.nome,
        email: e.email,
        telefone: e.telefone,
      }));

    res.json(entregadoresComPedido);
  } catch (err) {
    console.error("❌ Erro no listarPedidosAtivos:", err.message);
    res.status(500).json({ message: "Erro ao buscar entregadores com pedido." });
  }
}

/* =========================================================
   RESUMO DO DIA (entregador)
========================================================= */
async function resumoDoDia(req, res) {
  const { entregadorId } = req.params;
  const hoje = new Date();
  const inicio = new Date(hoje.setHours(0, 0, 0, 0));
  const fim = new Date(hoje.setHours(23, 59, 59, 999));

  try {
    const entregasHoje = await Pedido.find({
      entregador: entregadorId,
      status: "entregue",
      updatedAt: { $gte: inicio, $lte: fim },
    });

    res.json({ entregasHoje: entregasHoje.length });
  } catch (error) {
    console.error("Erro no resumoDoDia:", error.message);
    res.status(500).json({ message: "Erro ao buscar resumo do dia." });
  }
}

/* =========================================================
   LISTAR PEDIDOS (wrapper)
========================================================= */
const listarPedidos = async (req, res) => {
  try {
    const restauranteId = req.restauranteId || req.user?.restauranteId || req.userId;
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não autenticado." });

    req.params.restauranteId = restauranteId;
    return listarPedidosPorRestaurante(req, res);
  } catch (err) {
    return res.status(500).json({ message: "Erro ao listar pedidos.", error: err.message });
  }
};

/* =========================================================
   CANCELAR PEDIDO
========================================================= */
const cancelarPedido = async (req, res) => {
  try {
    const { pedidoId } = req.params;

    const restauranteId = req.restauranteId || req.user?.restauranteId || req.userId;
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não autenticado." });

    if (!mongoose.Types.ObjectId.isValid(pedidoId)) {
      return res.status(400).json({ message: "pedidoId inválido." });
    }

    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    if (String(pedido.restaurante) !== String(restauranteId)) {
      return res.status(403).json({ message: "Pedido não pertence a este restaurante." });
    }

    const st = String(pedido.status || "");
    if (st === "entregue") {
      return res.status(409).json({
        message: `Não é possível cancelar pedido com status '${pedido.status}'.`,
      });
    }

    if (st === "cancelado") {
      return res.json({ ok: true, message: "Pedido já estava cancelado.", pedido });
    }

    const motivo = (req.body?.motivo || req.body?.descricao || "").toString().trim() || null;
    const role = req.user?.role === "garcom" ? "garcom" : "restaurante";
    const canceladoPor = role === "garcom" ? req.user?.garcomId || null : req.userId || null;

    const itensAtuais = Array.isArray(pedido.itens) ? pedido.itens : [];
    if (itensAtuais.length > 0) {
      pedido.itensCancelados = Array.isArray(pedido.itensCancelados) ? pedido.itensCancelados : [];

      for (const it of itensAtuais) {
        const qtd = Number(it?.quantidade || 1);
        const unit = Number(it?.precoUnitario || 0);
        const totalItem = Number.isFinite(it?.precoTotal) ? Number(it.precoTotal) : qtd * unit;

        pedido.itensCancelados.push({
          item: it,
          canceladoEm: new Date(),
          motivo: motivo || "Cancelamento do pedido",
          canceladoPor: canceladoPor || null,
          canceladoPorRole: role,
          quantidadeCancelada: qtd,
          valorCancelado: totalItem,
        });
      }
    }

    pedido.status = "cancelado";
    pedido.statusPagamento = "cancelado";
    pedido.canceladoEm = new Date();
    pedido.motivoCancelamento = motivo;
    pedido.canceladoPorRole = role;
    pedido.canceladoPor = canceladoPor;

    // ✅ zera itens e total
    pedido.itens = [];
    pedido.valorTotal = 0;

    // ✅ zera pagamentos
    pedido.pagamentos = [];

    // ✅ zera mp/pix antigo
    pedido.mpPaymentId = null;
    pedido.pixQrCode = "";
    pedido.pixQrCodeBase64 = "";

    // ✅ recalcula coerência
    aplicarStatusPorPagamentoTotal(pedido);

    await pedido.save();

    let mesaAtualizada = null;
    const mesaId = pedido.mesaId;

    if (mesaId && mongoose.Types.ObjectId.isValid(String(mesaId))) {
      mesaAtualizada = await Mesa.findByIdAndUpdate(
        mesaId,
        {
          $set: {
            status: "livre",
            pedidoAtualId: null,
            pedidoAtualNumero: null,
            comandaNumero: null,
            ocupadaDesde: null,
          },
        },
        { new: true }
      );
    }

    if (req.io) {
      req.io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
      req.io.to(`restaurante-${restauranteId}`).emit("pedidoCancelado", {
        pedidoId: pedido._id,
        motivo: motivo || undefined,
      });

      if (mesaAtualizada) {
        req.io.to(`restaurante-${restauranteId}`).emit("mesaAtualizada", mesaAtualizada);
        req.io.to(`mesa-${String(mesaAtualizada._id)}`).emit("mesaAtualizada", mesaAtualizada);
      }
    }

    return res.json({ ok: true, pedido, mesa: mesaAtualizada });
  } catch (error) {
    console.error("Erro ao cancelar pedido:", error);
    return res.status(500).json({ message: "Erro ao cancelar pedido.", error: error.message });
  }
};

/* =========================================================
   CANCELAR ITEM DO PEDIDO
========================================================= */
const cancelarItemPedido = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const itemIndex = Number(req.params.itemIndex);

    const restauranteId = req.restauranteId || req.user?.restauranteId || req.userId;
    if (!restauranteId) return res.status(401).json({ message: "Restaurante não autenticado." });

    if (!Number.isInteger(itemIndex) || itemIndex < 0) {
      return res.status(400).json({ message: "itemIndex inválido." });
    }

    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    if (String(pedido.restaurante) !== String(restauranteId)) {
      return res.status(403).json({ message: "Pedido não pertence a este restaurante." });
    }

    const st = String(pedido.status || "");
    if (["entregue", "cancelado"].includes(st)) {
      return res.status(409).json({
        message: `Não é possível cancelar item com status '${pedido.status}'.`,
      });
    }

    const itensArr = Array.isArray(pedido.itens) ? pedido.itens : [];
    if (itemIndex >= itensArr.length) {
      return res.status(404).json({ message: "Item não encontrado (índice fora da lista)." });
    }

    const motivo = req.body?.motivo || null;
    const role = req.user?.role === "garcom" ? "garcom" : "restaurante";

    const item = itensArr[itemIndex];

    const qtd = Number(item?.quantidade || 1);
    const unit = Number(item?.precoUnitario || 0);
    const totalItem = Number.isFinite(item?.precoTotal) ? Number(item.precoTotal) : qtd * unit;

    pedido.itens.splice(itemIndex, 1);

    pedido.itensCancelados = pedido.itensCancelados || [];
    pedido.itensCancelados.push({
      item,
      canceladoEm: new Date(),
      motivo,
      canceladoPorRole: role,
      canceladoPor: role === "garcom" ? req.user?.garcomId || null : req.userId || null,
      quantidadeCancelada: qtd,
      valorCancelado: totalItem,
    });

    const novoTotal = (pedido.itens || []).reduce((acc, it) => {
      const q = Number(it?.quantidade || 1);
      const u = Number(it?.precoUnitario || 0);
      const t = Number.isFinite(it?.precoTotal) ? Number(it.precoTotal) : q * u;
      return acc + (Number.isFinite(t) ? t : 0);
    }, 0);

    pedido.valorTotal = Number.isFinite(novoTotal) ? novoTotal : 0;

    // ✅ após alterar itens e valorTotal
    aplicarStatusPorPagamentoTotal(pedido);

    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", pedido);
      req.io.to(`restaurante-${restauranteId}`).emit("itemCancelado", {
        pedidoId: pedido._id,
        itemIndex,
        motivo: motivo || undefined,
      });
    }

    return res.json({ ok: true, pedido });
  } catch (error) {
    console.error("Erro ao cancelar item:", error);
    return res.status(500).json({ message: "Erro ao cancelar item.", error: error.message });
  }
};

/* =========================================================
   REGISTRAR PAGAMENTO (BALCÃO)
========================================================= */
const registrarPagamentoPedido = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { metodo, valor, obs } = req.body;

    if (!["dinheiro", "cartao", "pix"].includes(String(metodo || "").toLowerCase())) {
      return res.status(400).json({ message: "Método inválido." });
    }

    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ message: "Valor inválido." });
    }

    const pedido = await Pedido.findById(pedidoId);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    if (["cancelado", "entregue"].includes(String(pedido.status))) {
      return res.status(409).json({ message: `Não é possível pagar pedido com status '${pedido.status}'.` });
    }

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    pedido.pagamentos.push({
      metodo: String(metodo).toLowerCase(),
      valor: round2(valorNum),
      status: "confirmado",
      recebidoEm: new Date(),
      recebidoPor: req.userId || null,
      recebidoPorRole: req.user?.role === "garcom" ? "garcom" : "restaurante",
      obs: obs || "",
      confirmadoEm: new Date(),
    });

    aplicarStatusPorPagamentoTotal(pedido);

    await pedido.save();

    req.io?.to(`restaurante-${pedido.restaurante}`).emit("pedidoAtualizado", pedido);

    return res.json({ ok: true, pedido });
  } catch (error) {
    console.error("Erro ao registrar pagamento:", error);
    return res.status(500).json({ message: "Erro ao registrar pagamento." });
  }
};

/* =========================================================
   PIX PARCIAL (BALCÃO)
========================================================= */
const gerarPixPedido = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { valor } = req.body;

    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ message: "Valor inválido." });
    }

    const pedido = await Pedido.findById(pedidoId).populate("restaurante");
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const restaurante = pedido.restaurante;
    if (!restaurante?.mercadoPago?.accessToken) {
      return res.status(400).json({ message: "Restaurante sem Mercado Pago." });
    }

    const client = new MercadoPagoConfig({
      accessToken: restaurante.mercadoPago.accessToken,
    });
    const payment = new Payment(client);

    const pagamentoMp = await payment.create({
      body: {
        transaction_amount: round2(valorNum),
        description: `PIX Parcial - Pedido ${pedido.numeroPedido}`,
        payment_method_id: "pix",
        payer: {
          email: process.env.MP_TEST_PAYER_EMAIL || "cliente@movyo.com",
        },
        external_reference: pedido._id.toString(),
      },
    });

    const tx = pagamentoMp?.point_of_interaction?.transaction_data;

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];
    pedido.pagamentos.push({
      metodo: "pix",
      valor: round2(valorNum),
      status: "pendente",
      mpPaymentId: String(pagamentoMp.id),
      pixQrCode: tx?.qr_code || "",
      pixQrCodeBase64: tx?.qr_code_base64 || "",
      mpStatus: pagamentoMp.status,
    });

    await pedido.save();

    return res.json({
      paymentId: pagamentoMp.id,
      qrCode: tx?.qr_code,
      qrCodeBase64: tx?.qr_code_base64,
    });
  } catch (error) {
    console.error("Erro ao gerar PIX parcial:", error);
    res.status(500).json({ message: "Erro ao gerar PIX." });
  }
};

const consultarStatusPixPedido = async (req, res) => {
  try {
    const { pedidoId, paymentId } = req.params;

    const pedido = await Pedido.findById(pedidoId).populate("restaurante");
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const pagamento = (pedido.pagamentos || []).find((p) => p.mpPaymentId === paymentId);

    if (!pagamento) {
      return res.status(404).json({ message: "Pagamento PIX não encontrado." });
    }

    const client = new MercadoPagoConfig({
      accessToken: pedido.restaurante.mercadoPago.accessToken,
    });
    const payment = new Payment(client);

    const mpStatus = await payment.get({ id: paymentId });

    pagamento.mpStatus = mpStatus.status;

    if (mpStatus.status === "approved" && pagamento.status !== "confirmado") {
      pagamento.status = "confirmado";
      pagamento.confirmadoEm = new Date();

      aplicarStatusPorPagamentoTotal(pedido);
    }

    await pedido.save();

    return res.json({
      status: pagamento.status,
      mpStatus: pagamento.mpStatus,
      pedido,
    });
  } catch (error) {
    console.error("Erro ao consultar PIX:", error);
    res.status(500).json({ message: "Erro ao consultar status PIX." });
  }
};

/* =========================================================
   CRIAR/ATUALIZAR PEDIDO BALCÃO (CORRIGIDO!)
========================================================= */
const criarOuAtualizarPedidoBalcao = async (req, res) => {
  try {
    const {
      restaurante,
      nomeCliente,
      telefoneCliente,
      enderecoCliente,
      residenciaNumero,
      residenciaComplemento,
      residenciaReferencia,
      residenciaBairro,
      residenciaCep,
      itens = [],
      formadePagamento,
      descricaoPedido,
      mesaId,
      pedidoId,
    } = req.body;

    if (!restaurante) {
      return res.status(400).json({ message: "Restaurante é obrigatório." });
    }

    const telefoneNormalizado = (telefoneCliente || "").replace(/\D/g, "");
    const restDoc = await Restaurante.findById(restaurante).select("_id").lean();
    if (!restDoc) {
      return res.status(404).json({ message: "Restaurante não encontrado." });
    }

    const itensArr = seedCozinhaOnItens(Array.isArray(itens) ? itens.filter(Boolean) : []);

    const total = round2(
      itensArr.reduce((acc, it) => {
        const q = Number(it?.quantidade || 1);
        const u = Number(it?.precoUnitario || 0);
        const t = Number.isFinite(it?.precoTotal) ? Number(it.precoTotal) : q * u;
        return acc + (Number.isFinite(t) ? t : 0);
      }, 0)
    );

    if (!Number.isFinite(total) || total < 0) {
      return res.status(400).json({ message: "Total inválido." });
    }

    if (telefoneNormalizado) {
      const clienteExistente = await Cliente.findOne({ telefone: telefoneNormalizado });

      const parsedEndereco = parseEnderecoParaCliente(enderecoCliente, residenciaNumero, residenciaBairro);

      const endereco = {
        apelido: "balcao",
        rua: parsedEndereco.rua,
        numero: parsedEndereco.numero,
        bairro: parsedEndereco.bairro,
        cidade: "Olinda",
        estado: "PE",
        cep: residenciaCep,
      };

      if (clienteExistente) {
        const enderecoExiste = clienteExistente.enderecos?.some(
          (e) => e.rua === endereco.rua && e.numero === endereco.numero
        );
        if (!enderecoExiste) {
          clienteExistente.enderecos.push(endereco);
          await clienteExistente.save();
        }
      } else {
        await new Cliente({
          nome: nomeCliente || "Cliente",
          telefone: telefoneNormalizado,
          enderecos: [endereco],
        }).save();
      }
    }

    let pedido = null;

    if (pedidoId && mongoose.Types.ObjectId.isValid(String(pedidoId))) {
      pedido = await Pedido.findById(pedidoId);
      if (pedido && String(pedido.restaurante) !== String(restaurante)) {
        return res.status(403).json({ message: "Pedido não pertence a este restaurante." });
      }
    }

    let mesa = null;
    const mesaValida = mesaId && mongoose.Types.ObjectId.isValid(String(mesaId));
    if (!pedido && mesaValida) {
      mesa = await Mesa.findById(mesaId);
      if (mesa?.pedidoAtualId && mongoose.Types.ObjectId.isValid(String(mesa.pedidoAtualId))) {
        pedido = await Pedido.findById(mesa.pedidoAtualId);
      }
    }

    if (!pedido && telefoneNormalizado) {
      const candidato = await Pedido.findOne({
        restaurante,
        origem: "balcao",
        telefoneCliente: telefoneNormalizado,
        status: "aguardando_pagamento",
      }).sort({ createdAt: -1, criadoEm: -1 });

      if (canReuseBalcaoPedido(candidato)) pedido = candidato;
    }

    if (!pedido) {
      const prefixo = "BK";
      const regex = new RegExp(`${prefixo}(\\d+)`);
      const ultimo = await Pedido.findOne({ origem: "balcao", restaurante }).sort({ criadoEm: -1 });
      const ultimoNumero = ultimo?.numeroPedido?.match(regex)?.[1] || "0";
      const novoNumero = String(Number(ultimoNumero) + 1).padStart(5, "0");

      const novoPedido = new Pedido({
        numeroPedido: `${prefixo}${novoNumero}`,
        nomeCliente,
        telefoneCliente: telefoneNormalizado,
        enderecoCliente,
        residenciaNumero,
        residenciaComplemento,
        residenciaReferencia,
        residenciaBairro,
        residenciaCep,

        itens: itensArr,
        valorTotal: total,

        valorPago: 0,
        valorPendente: total,

        formadePagamento: formadePagamento || "pendente",
        descricaoPedido,

        restaurante,
        origem: "balcao",
        status: "aguardando_pagamento",

        pagamentos: [],

        mesaId: mesaValida ? mesaId : null,
      });

      aplicarStatusPorPagamentoTotal(novoPedido);

      await novoPedido.save();

      if (novoPedido.mesaId) {
        await Mesa.findByIdAndUpdate(
          novoPedido.mesaId,
          {
            $set: {
              status: "ocupada",
              pedidoAtualId: novoPedido._id,
              pedidoAtualNumero: novoPedido.numeroPedido,
              ocupadaDesde: new Date(),
            },
          },
          { new: true }
        );
      }

      req.io?.to(`restaurante-${restaurante}`).emit("novoPedido", novoPedido);
      return res.status(201).json({ ok: true, criado: true, pedido: novoPedido });
    }

    const st = String(pedido.status || "");
    if (["cancelado", "entregue"].includes(st)) {
      return res.status(409).json({
        message: `Não é possível alterar pedido com status '${pedido.status}'.`,
      });
    }

    if (String(pedido.origem || "") !== "balcao") {
      return res.status(409).json({ message: "Este endpoint é exclusivo para pedidos de balcão." });
    }

    pedido.nomeCliente = nomeCliente ?? pedido.nomeCliente;
    pedido.telefoneCliente = telefoneNormalizado || pedido.telefoneCliente;

    pedido.enderecoCliente = enderecoCliente ?? pedido.enderecoCliente;
    pedido.residenciaNumero = residenciaNumero ?? pedido.residenciaNumero;
    pedido.residenciaComplemento = residenciaComplemento ?? pedido.residenciaComplemento;
    pedido.residenciaReferencia = residenciaReferencia ?? pedido.residenciaReferencia;
    pedido.residenciaBairro = residenciaBairro ?? pedido.residenciaBairro;
    pedido.residenciaCep = residenciaCep ?? pedido.residenciaCep;

    pedido.descricaoPedido = descricaoPedido ?? pedido.descricaoPedido;
    pedido.formadePagamento = formadePagamento ?? pedido.formadePagamento;

    pedido.itens = itensArr;
    pedido.valorTotal = total;

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    aplicarStatusPorPagamentoTotal(pedido);

    if (mesaValida) {
      pedido.mesaId = mesaId;

      await Mesa.findByIdAndUpdate(
        mesaId,
        {
          $set: {
            status: "ocupada",
            pedidoAtualId: pedido._id,
            pedidoAtualNumero: pedido.numeroPedido,
            ocupadaDesde: new Date(),
          },
        },
        { new: true }
      );
    }

    await pedido.save();

    req.io?.to(`restaurante-${restaurante}`).emit("pedidoAtualizado", pedido);

    return res.json({ ok: true, criado: false, pedido });
  } catch (error) {
    console.error("Erro ao abrir/atualizar pedido balcão:", error);
    return res.status(500).json({
      message: "Erro ao abrir/atualizar pedido balcão.",
      error: error.message,
    });
  }
};

module.exports = {
  criarPedido,
  listarPedidosPorRestaurante,
  enviarParaEntregador,
  buscarClientePorTelefone,
  criarOuAtualizarCliente,
  listarPedidosDoCliente,
  atualizarStatusPedido,
  getStatusPedido,
  obterPedidoPorId,
  iniciarEntrega,
  concluirEntrega,
  listarPedidosAtivos,
  resumoDoDia,
  listarPedidos,
  cancelarPedido,
  cancelarItemPedido,
  criarOuAtualizarPedidoBalcao,
  registrarPagamentoPedido,
  gerarPixPedido,
  consultarStatusPixPedido,

  // ✅ COZINHA
  listarFilaCozinha,
  marcarItemPronto,
  marcarItemEntregueMesa,
  marcarItemEntregueCliente,
};
