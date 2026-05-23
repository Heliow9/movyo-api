// controllers/balcaoController.js
const mongoose = require("../lib/mongoId");

const Pedido = require("../models/Pedido");
const Restaurante = require("../models/Restaurante");

const { criarPagamentoPix, consultarPagamento } = require("../services/mercadoPagoPixService");
const { enviarMensagem, enviarMensagemMidia, estaConectado } = require("../utils/bot");

/* -----------------------
   Helpers gerais (igual Mesa)
-------------------------*/
const toNum = (v) => {
  const n = Number(String(v ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}


function normalizarItemBalcao(i = {}) {
  const produto = i.produto && typeof i.produto === "object" ? i.produto : {};
  const qtd = Math.max(1, toNum(i.quantidade ?? i.qtd ?? i.quantity ?? i.qtde ?? 1));
  const unitRaw = i.precoUnitario ?? i.valorUnitario ?? i.preco ?? i.valor ?? i.price ?? i.precoBase ?? produto.preco ?? produto.precoBase ?? 0;
  let unit = toNum(unitRaw);
  const totalRaw = i.precoTotal ?? i.total ?? i.valorTotal ?? i.subtotal ?? i.valorItemTotal;
  let total = toNum(totalRaw);
  if (total <= 0 && unit > 0) total = unit * qtd;
  if (unit <= 0 && total > 0) unit = total / qtd;

  const nome = String(i.nome || i.titulo || i.title || i.descricao || produto.nome || produto.titulo || "Item").trim() || "Item";
  const produtoId = i.produtoId || i.produto || i.produto_id || produto._id || produto.id || null;

  return {
    ...i,
    produtoId: typeof produtoId === "object" ? (produtoId._id || produtoId.id || null) : produtoId,
    nome,
    quantidade: qtd,
    qtd,
    precoUnitario: round2(unit),
    preco: round2(unit),
    valorUnitario: round2(unit),
    precoTotal: round2(total),
    total: round2(total),
    valorTotal: round2(total),
    imprimir: i.imprimir ?? i.imprimeNaCozinha ?? true,
    imprimeNaCozinha: i.imprimeNaCozinha ?? i.imprimir ?? true,
    observacao: String(i.observacao || i.obs || "").trim(),
    saboresSelecionados: Array.isArray(i.saboresSelecionados) ? i.saboresSelecionados : (Array.isArray(i.sabores) ? i.sabores : []),
    bordaSelecionada: i.bordaSelecionada || null,
    adicionalSelecionado: i.adicionalSelecionado || null,
    complementosSelecionados: Array.isArray(i.complementosSelecionados) ? i.complementosSelecionados : [],
    tiposExtrasSelecionados: i.tiposExtrasSelecionados && typeof i.tiposExtrasSelecionados === "object" ? i.tiposExtrasSelecionados : {},
  };
}

function normalizarItensBalcao(itens = []) {
  return (Array.isArray(itens) ? itens : []).map(normalizarItemBalcao).filter((i) => i.nome && Number(i.quantidade) > 0);
}


function extrairItensResumoBody(body = {}) {
  const candidatos = [
    body.itens,
    body.itensPedido,
    body.itensDetalhados,
    body.produtos,
    body.pedidoItens,
    body.carrinho,
    body.orderItems,
    body?.pedido?.itens,
    body?.pedido?.itensPedido,
    body?.pedido?.produtos,
  ];

  for (const cand of candidatos) {
    const itens = normalizarItensBalcao(cand);
    if (itens.length) return itens;
  }

  return [];
}

function totalItensBalcao(itens = []) {
  return round2((Array.isArray(itens) ? itens : []).reduce((acc, it) => {
    const qtd = Math.max(1, toNum(it?.quantidade ?? it?.qtd ?? 1));
    const total = toNum(it?.precoTotal ?? it?.total ?? it?.valorTotal ?? 0);
    const unit = toNum(it?.precoUnitario ?? it?.preco ?? it?.valorUnitario ?? 0);
    return acc + (total > 0 ? total : unit * qtd);
  }, 0));
}

function assinaturaResumoWhats(item = {}) {
  const produtoId = String(item.produtoId || item.produto?._id || item.produto?.id || "");
  const nome = String(item.nome || item.titulo || item.title || item.descricao || "Item").trim().toLowerCase();
  const qtd = Number(item.quantidade || item.qtd || item.quantity || 1) || 1;
  const total = round2(toNum(item.precoTotal ?? item.total ?? item.valorTotal ?? 0));
  const unit = round2(toNum(item.precoUnitario ?? item.preco ?? item.valorUnitario ?? 0));
  const extras = JSON.stringify({
    sabores: item.saboresSelecionados || item.sabores || [],
    borda: item.bordaSelecionada || item.borda || null,
    adicional: item.adicionalSelecionado || item.adicional || null,
    complementos: item.complementosSelecionados || item.complementos || [],
    tipos: item.tiposExtrasSelecionados || {},
    obs: String(item.observacao || item.obs || "").trim().toLowerCase(),
  });
  return `${produtoId}|${nome}|${qtd}|${unit}|${total}|${extras}`;
}

function deduplicarItensResumoWhats(itens = []) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(itens) ? itens : []) {
    const sig = assinaturaResumoWhats(item);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(item);
  }
  return out;
}

function calcularTotalPedido(pedido) {
  const vt = toNum(pedido?.valorTotal);
  if (vt > 0) return round2(vt);

  const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
  const total = itens.reduce((acc, it) => {
    const qtd = Math.max(1, Number(it?.quantidade || 1));
    const unit = toNum(it?.precoUnitario);
    const tot = toNum(it?.precoTotal);
    return acc + (tot > 0 ? tot : unit * qtd);
  }, 0);

  return round2(total);
}

function isPaidStatus(st) {
  const s = String(st || "").toLowerCase();
  return s === "approved" || s === "paid" || s === "aprovado" || s === "confirmado";
}

function formatBRL(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

function extrairNomeExtra(x) {
  if (!x) return "";
  if (typeof x === "string") return x.trim();
  return String(x.nome || x.titulo || x.title || x.descricao || x.label || x.sabor || x.adicional || x.complemento || "").trim();
}

function formatarExtrasItem(item = {}) {
  const linhas = [];

  const addLista = (label, arr) => {
    const nomes = (Array.isArray(arr) ? arr : [])
      .map(extrairNomeExtra)
      .filter(Boolean);
    if (nomes.length) linhas.push(`   • ${label}: ${nomes.join(", ")}`);
  };

  addLista("Sabores", item.saboresSelecionados || item.sabores);

  const borda = extrairNomeExtra(item.bordaSelecionada || item.borda);
  if (borda) linhas.push(`   • Borda: ${borda}`);

  const adicional = extrairNomeExtra(item.adicionalSelecionado || item.adicional);
  if (adicional) linhas.push(`   • Adicional: ${adicional}`);

  addLista("Complementos", item.complementosSelecionados || item.complementos);
  addLista("Extras", item.extrasSelecionados || item.extras);

  const tipos = item.tiposExtrasSelecionados;
  if (tipos && typeof tipos === "object" && !Array.isArray(tipos)) {
    Object.entries(tipos).forEach(([grupo, valor]) => {
      const nomes = (Array.isArray(valor) ? valor : [valor]).map(extrairNomeExtra).filter(Boolean);
      if (nomes.length) linhas.push(`   • ${grupo}: ${nomes.join(", ")}`);
    });
  }

  const obs = String(item.observacao || item.obs || "").trim();
  if (obs) linhas.push(`   • Obs: ${obs}`);

  return linhas;
}


function assinaturaItemPedido(item = {}) {
  const qtd = Number(item.quantidade || item.qtd || item.quantity || 1) || 1;
  const nome = String(item.nome || item.titulo || item.title || item.descricao || "Item").trim().toLowerCase();
  const total = round2(toNum(item.precoTotal ?? item.total ?? item.valorTotal ?? 0));
  const unit = round2(toNum(item.precoUnitario ?? item.preco ?? item.valorUnitario ?? 0));
  const obs = String(item.observacao || item.obs || "").trim().toLowerCase();
  return `${qtd}|${nome}|${total}|${unit}|${obs}`;
}

function mesmosItensPedido(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.map(assinaturaItemPedido).join("||") === b.map(assinaturaItemPedido).join("||");
}

function montarResumoItensPedido(pedido) {
  const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
  if (!itens.length) return "🛒 *Itens do pedido:*\n• Nenhum item encontrado no pedido.";

  const linhas = ["🛒 *Itens do pedido:*"];
  itens.forEach((item, idx) => {
    const qtd = Number(item.quantidade || item.qtd || item.quantity || 1) || 1;
    const nome = String(item.nome || item.titulo || item.title || item.descricao || "Item").trim() || "Item";
    const total = toNum(item.precoTotal ?? item.total ?? item.valorTotal ?? 0);
    const unit = toNum(item.precoUnitario ?? item.preco ?? item.valorUnitario ?? 0);
    const valorLinha = total > 0 ? total : unit * qtd;
    linhas.push(`${idx + 1}. ${qtd}x ${nome} — ${formatBRL(valorLinha)}`);
    linhas.push(...formatarExtrasItem(item));
  });
  return linhas.join("\n");
}

async function notificarPedidoNovoSePago(req, pedido) {
  if (!req?.io || !pedido) return;
  const statusPagamento = String(pedido.statusPagamento || "").toLowerCase();
  const pendente = Number(pedido.valorPendente || 0);
  const total = Number(pedido.valorTotal || pedido.total || 0);
  if ((statusPagamento === "pago" || pendente <= 0) && total > 0) {
    req.io.to(`restaurante-${String(pedido.restaurante)}`).emit("novoPedido", pedido);
  }
}

/**
 * ✅ Pega usuário (garçom/restaurante) de forma robusta
 */
function getGarcomFromReq(req) {
  const u =
    req?.user ||
    req?.garcom ||
    req?.garcomUser ||
    req?.auth?.user ||
    req?.auth?.garcom ||
    null;

  const id = u?._id ? String(u._id) : null;
  const nome = u?.apelido || u?.nome || null;

  return { id, nome };
}

/* -----------------------
   Segurança: pedido pertence ao restaurante?
-------------------------*/
async function assertPedidoDoRestaurante(req, pedidoId) {
  const pedido = await Pedido.findById(pedidoId);
  if (!pedido) {
    const err = new Error("Pedido não encontrado");
    err.status = 404;
    throw err;
  }

  const pedidoRestId = String(pedido.restaurante || "");
  const tokenRestId =
    String(req.restauranteId || "") ||
    String(req.user?.restauranteId || "") ||
    String(req.userId || "");

  // se você usa token de restauranteId nas rotas do painel, aqui mantém coerência
  if (tokenRestId && pedidoRestId && pedidoRestId !== tokenRestId) {
    const err = new Error("Pedido não pertence a este restaurante.");
    err.status = 403;
    throw err;
  }

  return pedido;
}

/* -----------------------
   ✅ Pagamentos parciais (igual Mesa)
-------------------------*/
function sumPagamentosConfirmados(pedido) {
  const arr = Array.isArray(pedido?.pagamentos) ? pedido.pagamentos : [];
  return round2(
    arr.reduce((acc, p) => {
      if (!p) return acc;
      if (String(p.status || "").toLowerCase() !== "confirmado") return acc;
      return acc + toNum(p.valor);
    }, 0)
  );
}

function recalcPagamentoPedido(pedido) {
  const total = calcularTotalPedido(pedido);

  let pago = sumPagamentosConfirmados(pedido);

  // compat fluxo antigo: pedido "pago" sem pagamentos[]
  if (String(pedido?.status || "").toLowerCase() === "pago" && (!pago || pago <= 0)) {
    pago = total;
  }

  const pendente = Math.max(0, round2(total - pago));

  pedido.valorTotal = total;
  pedido.valorPago = round2(pago);
  pedido.valorPendente = round2(pendente);

  if (pendente <= 0 && total > 0) {
    // Balcão/garçom quitado NÃO deve voltar para Recebidos.
    // Assim que quitou, entra/fica em produção para a cozinha.
    pedido.status = "em_producao";
    pedido.statusPagamento = "pago";
    if (!pedido.pagoEm) pedido.pagoEm = new Date();
  } else {
    pedido.statusPagamento = "pendente";
    // Se ainda não foi para produção, mantém aguardando pagamento.
    if (!["em_producao", "em_entrega", "entregue", "cancelado"].includes(String(pedido.status || "").toLowerCase())) {
      pedido.status = "aguardando_pagamento";
    }
  }

  return { total, pago: pedido.valorPago, pendente: pedido.valorPendente };
}

/**
 * ✅ fecha pedido balcão (sem mesa pra liberar)
 */
async function fecharPedidoGenerico({ req, pedido }) {
  const agora = new Date();

  if (!pedido.fechadoEm) pedido.fechadoEm = agora;

  const g = getGarcomFromReq(req);
  if (req.role === "garcom" && g.id) {
    pedido.fechadoPor = g.id;
    pedido.fechadoPorRole = "garcom";
    pedido.garcomId = pedido.garcomId || g.id;
    pedido.garcomNome = pedido.garcomNome || g.nome;
  } else if (req?.userId) {
    pedido.fechadoPor = req.userId;
    pedido.fechadoPorRole = "restaurante";
  }

  // garante pedido quitado em produção, não em Recebidos
  const { total, pago, pendente } = recalcPagamentoPedido(pedido);
  if (pendente <= 0 && total > 0) {
    pedido.status = "em_producao";
    pedido.statusPagamento = "pago";
    if (!pedido.pagoEm) pedido.pagoEm = agora;
  }

  await pedido.save();

  if (req.io) {
    req.io.to(`restaurante-${String(pedido.restaurante)}`).emit("pedidoAtualizado", pedido);
  }

  return { pedido, total, pago, pendente };
}

/* =========================
   LISTAR ABERTOS (balcão)
========================= */
exports.listarPedidosBalcaoAbertos = async (req, res) => {
  try {
    const { restauranteId } = req.params;

    const pedidos = await Pedido.find({
      restaurante: restauranteId,
      origem: "balcao",
      canceladoEm: null,
      status: { $in: ["aguardando_pagamento", "em_producao", "aguardando_resposta"] },
    }).sort({ createdAt: -1 });

    // opcional: recalcular (leve) só quando necessário
    // (se quiser, dá pra recalcular só ao abrir detalhes)
    return res.json(pedidos);
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar pedidos balcão", error: error?.message });
  }
};

/* =========================
   ABRIR PEDIDO (balcão)
========================= */
exports.abrirPedidoBalcao = async (req, res) => {
  try {
    const { restauranteId, nomeCliente, telefoneCliente, itens } = req.body;

    if (!restauranteId) {
      return res.status(400).json({ message: "Envie restauranteId." });
    }

    const itensIniciais = normalizarItensBalcao(itens);
    const totalInicial = round2(itensIniciais.reduce((acc, i) => acc + toNum(i.precoTotal), 0));

    const novoPedido = new Pedido({
      restaurante: restauranteId,
      mesaId: null,
      nomeCliente: nomeCliente || "Cliente balcão",
      telefoneCliente: telefoneCliente || "",
      itens: itensIniciais,
      valorTotal: totalInicial,
      total: totalInicial,
      origem: "balcao",
      status: "aguardando_pagamento",
      formadePagamento: "pendente",
      pagamentos: [],
      valorPago: 0,
      valorPendente: totalInicial,
    });

    // se for garçom abrindo no balcão (caso use)
    if (req.role === "garcom") {
      const g = getGarcomFromReq(req);
      if (g.id) {
        novoPedido.garcomId = g.id;
        novoPedido.garcomNome = g.nome;
      }
    }

    await novoPedido.save();

    if (req.io) {
      // Não dispara "novoPedido" aqui: balcão com PIX ainda pendente não deve tocar notificação no desktop.
      req.io.to(`restaurante-${restauranteId}`).emit("pedidoAtualizado", novoPedido);
    }

    return res.status(201).json({ pedido: novoPedido });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao abrir pedido balcão", error: error?.message });
  }
};

/* =========================
   BUSCAR DETALHES (balcão)
========================= */
exports.buscarPedidoBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });

    recalcPagamentoPedido(pedido);
    await pedido.save().catch(() => {});

    return res.json({ pedido });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao buscar pedido balcão" });
  }
};

/* =========================
   ADICIONAR ITENS (balcão)
========================= */
exports.adicionarItensBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { itens } = req.body;

    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ message: "Envie um array de itens válido." });
    }

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const itensNormalizados = normalizarItensBalcao(itens);
    if (!itensNormalizados.length) {
      return res.status(400).json({ message: "Nenhum item válido para adicionar." });
    }

    const totalRodada = itensNormalizados.reduce((acc, i) => acc + toNum(i.precoTotal), 0);

    pedido.itens = Array.isArray(pedido.itens) ? pedido.itens : [];

    // Proteção contra duplicidade: versões antigas do app abriam o pedido com itens
    // e logo em seguida chamavam /itens com o mesmo carrinho. Nesse caso não soma de novo.
    const deveSubstituir =
      req.body?.substituirItens === true ||
      req.body?.replaceItems === true ||
      req.body?.atualizarItens === true ||
      mesmosItensPedido(pedido.itens, itensNormalizados);

    if (deveSubstituir) {
      pedido.itens = itensNormalizados;
      pedido.valorTotal = round2(totalRodada);
      pedido.total = round2(totalRodada);
      pedido.valorPago = round2(toNum(pedido.valorPago));
      pedido.valorPendente = round2(Math.max(0, totalRodada - toNum(pedido.valorPago)));
    } else {
      pedido.itens.push(...itensNormalizados);
      pedido.valorTotal = round2(Number(pedido.valorTotal || 0) + totalRodada);
      pedido.total = pedido.valorTotal;
    }

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);
    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${String(pedido.restaurante)}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({ ok: true, pedido, total, pago, pendente });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao adicionar itens (balcão)" });
  }
};

/* =========================
   PAGAMENTO PARCIAL (dinheiro/cartão)
========================= */
exports.registrarPagamentoBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { metodo, valor, obs } = req.body;

    const m = String(metodo || "").toLowerCase();
    if (!["dinheiro", "cartao"].includes(m)) {
      return res.status(400).json({ message: "Método inválido. Use dinheiro ou cartao." });
    }

    const v = round2(toNum(valor));
    if (!Number.isFinite(v) || v <= 0) {
      return res.status(400).json({ message: "Valor inválido." });
    }

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    // Compat: se o app do garçom mandar pagamento junto com itens, garante que nada seja impresso zerado/vazio.
    const itensBody = normalizarItensBalcao(req.body?.itens);
    if (itensBody.length && (!Array.isArray(pedido.itens) || pedido.itens.length === 0)) {
      pedido.itens = itensBody;
      const totalItensBody = round2(itensBody.reduce((acc, i) => acc + toNum(i.precoTotal), 0));
      pedido.valorTotal = totalItensBody;
      pedido.total = totalItensBody;
      pedido.valorPendente = totalItensBody;
    }

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    const g = getGarcomFromReq(req);
    const recebidoPorRole = req.role === "garcom" ? "garcom" : "restaurante";
    const recebidoPorId =
      recebidoPorRole === "garcom" ? (g.id || null) : (req.userId ? String(req.userId) : null);

    pedido.pagamentos.push({
      metodo: m,
      valor: v,
      status: "confirmado",
      recebidoEm: new Date(),
      recebidoPor:
        recebidoPorId && mongoose.Types.ObjectId.isValid(recebidoPorId)
          ? new mongoose.Types.ObjectId(recebidoPorId)
          : null,
      recebidoPorRole,
      obs: String(obs || "").trim(),
    });

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);

    const metodosConfirmados = new Set(
      (pedido.pagamentos || [])
        .filter((p) => String(p.status || "").toLowerCase() === "confirmado")
        .map((p) => String(p.metodo || "").toLowerCase())
        .filter(Boolean)
    );

    if (metodosConfirmados.size > 1) pedido.formadePagamento = "misto";
    else if (metodosConfirmados.size === 1) pedido.formadePagamento = [...metodosConfirmados][0];

    // se quitou, já fecha o pedido balcão
    if (pendente <= 0 && total > 0) {
      const out = await fecharPedidoGenerico({ req, pedido });
      return res.json({ ok: true, fechado: true, ...out });
    }

    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${String(pedido.restaurante)}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({ ok: true, fechado: false, pedido, total, pago, pendente });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao registrar pagamento (balcão)" });
  }
};

/* =========================
   GERAR PIX PARCIAL (balcão)
========================= */
exports.gerarPixBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const valorReq = req.body?.valor;

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const { pendente: pendenteAntes, total } = recalcPagamentoPedido(pedido);
    await pedido.save().catch(() => {});

    const valorPix = round2(toNum(valorReq != null ? valorReq : pendenteAntes));
    if (!Number.isFinite(valorPix) || valorPix <= 0) {
      return res.status(400).json({ message: "Valor PIX inválido." });
    }
    if (valorPix > total) {
      return res.status(400).json({ message: "Valor PIX não pode ser maior que o total." });
    }

    const restaurante = await Restaurante.findById(pedido.restaurante).select("nome mercadoPago telefone");
    if (!restaurante) return res.status(404).json({ message: "Restaurante não encontrado." });

    const conectado = !!restaurante?.mercadoPago?.conectado;
    const accessToken = restaurante?.mercadoPago?.accessToken;

    if (!conectado || !accessToken) {
      return res.status(400).json({
        message: "Pix indisponível: restaurante não conectado ao Mercado Pago.",
        code: "MP_NAO_CONECTADO",
      });
    }

    const nomeCliente = pedido?.nomeCliente || "Cliente";
    const telefoneCliente = pedido?.telefoneCliente || restaurante?.telefone || "";

    const pix = await criarPagamentoPix({
      accessToken,
      pedidoId: pedido?.numeroPedido || String(pedido._id),
      valorTotal: valorPix,
      nomeCliente,
      telefoneCliente,
    });

    pedido.pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    const g = getGarcomFromReq(req);
    const recebidoPorRole = req.role === "garcom" ? "garcom" : "restaurante";
    const recebidoPorId =
      recebidoPorRole === "garcom" ? (g.id || null) : (req.userId ? String(req.userId) : null);

    pedido.pagamentos.push({
      metodo: "pix",
      valor: valorPix,
      status: "pendente",
      recebidoEm: new Date(),
      recebidoPor:
        recebidoPorId && mongoose.Types.ObjectId.isValid(recebidoPorId)
          ? new mongoose.Types.ObjectId(recebidoPorId)
          : null,
      recebidoPorRole,
      mpPaymentId: pix?.paymentId ? String(pix.paymentId) : null,
      mpStatus: pix?.status || "pending",
      pixQrCode: pix?.qrCode || "",
      pixQrCodeBase64: pix?.qrCodeBase64 || "",
    });

    pedido.formadePagamento = (pedido.pagamentos || []).length > 1 ? "misto" : "pix";

    recalcPagamentoPedido(pedido);
    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${String(pedido.restaurante)}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({
      ok: true,
      pedidoId: String(pedido._id),
      paymentId: pix?.paymentId ? String(pix.paymentId) : null,
      statusPagamento: pix?.status || "pending",
      valor: valorPix,
      qrCode: pix?.qrCode || "",
      qrCodeBase64: pix?.qrCodeBase64 || "",
      total: pedido.valorTotal,
      pago: pedido.valorPago,
      pendente: pedido.valorPendente,
    });
  } catch (error) {
    const mpStatus = error?.response?.status;
    const mpData = error?.response?.data;

    console.error("🔥 gerarPixBalcao MP:", mpStatus, mpData || error);

    return res.status(mpStatus || 500).json({
      message: mpData?.message || mpData?.error || error?.message || "Erro ao gerar Pix (balcão).",
      error: mpData || error?.message,
    });
  }
};

/* =========================
   STATUS PIX (balcão) + confirma se pago
========================= */
exports.statusPixBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;

    const paymentId =
      String(req.params?.paymentId || "").trim() ||
      String(req.query?.paymentId || "").trim();

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const restaurante = await Restaurante.findById(pedido.restaurante).select("mercadoPago");
    const accessToken = restaurante?.mercadoPago?.accessToken;

    if (!accessToken) {
      return res.status(400).json({ message: "Restaurante não conectado ao Mercado Pago." });
    }

    const pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    let alvo = null;
    if (paymentId) {
      alvo = pagamentos.find((p) => p?.mpPaymentId && String(p.mpPaymentId) === paymentId) || null;
    } else {
      for (let i = pagamentos.length - 1; i >= 0; i--) {
        const p = pagamentos[i];
        if (String(p?.metodo || "").toLowerCase() === "pix" && String(p?.status || "") === "pendente") {
          alvo = p;
          break;
        }
      }
    }

    if (!alvo?.mpPaymentId) {
      return res.status(404).json({ message: "Pagamento PIX pendente não encontrado." });
    }

    const mp = await consultarPagamento({ accessToken, paymentId: String(alvo.mpPaymentId) });
    const st = String(mp?.status || "").toLowerCase() || alvo.mpStatus || "pending";

    if (mp?.point_of_interaction?.transaction_data?.qr_code) {
      alvo.pixQrCode = mp.point_of_interaction.transaction_data.qr_code;
    }
    if (mp?.point_of_interaction?.transaction_data?.qr_code_base64) {
      alvo.pixQrCodeBase64 = mp.point_of_interaction.transaction_data.qr_code_base64;
    }

    alvo.mpStatus = st;

    if (isPaidStatus(st)) {
      alvo.status = "confirmado";
      // alvo.confirmadoEm = new Date(); // se quiser
    }

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);

    // se quitou, fecha o pedido balcão automaticamente
    if (pendente <= 0 && total > 0) {
      const out = await fecharPedidoGenerico({ req, pedido });
      await notificarPedidoNovoSePago(req, pedido);

      const numeroConfirmacao = String(alvo.whatsappPixNumero || pedido.telefoneCliente || "").replace(/\D/g, "");
      if (numeroConfirmacao && estaConectado(String(pedido.restaurante))) {
        await enviarMensagem(
          String(pedido.restaurante),
          numeroConfirmacao,
          `✅ *Pagamento confirmado!*

Seu pedido de balcão foi confirmado e já foi enviado para produção.

🧾 *Total:* ${formatBRL(total)}`
        ).catch(() => {});
      }

      return res.json({
        ok: true,
        paid: true,
        fechado: true,
        status: st,
        paymentId: String(alvo.mpPaymentId),
        ...out,
      });
    }

    await pedido.save();

    if (req.io) {
      req.io.to(`restaurante-${String(pedido.restaurante)}`).emit("pedidoAtualizado", pedido);
    }

    return res.json({
      ok: true,
      paid: isPaidStatus(st),
      fechado: false,
      status: st,
      paymentId: String(alvo.mpPaymentId),
      total,
      pago,
      pendente,
      qrCode: alvo.pixQrCode || "",
      qrCodeBase64: alvo.pixQrCodeBase64 || "",
    });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({
      message: error?.message || "Erro ao consultar status do Pix (balcão).",
      error: error?.message,
    });
  }
};

/* =========================
   FECHAR PEDIDO (balcão) - respeita parcial
========================= */
exports.fecharPedidoBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);

    if (pendente > 0) {
      await pedido.save().catch(() => {});
      return res.status(409).json({
        message: "Ainda falta pagar para encerrar o pedido.",
        total,
        pago,
        pendente,
        pedido,
      });
    }

    const out = await fecharPedidoGenerico({ req, pedido });

    return res.json({
      message: "Pedido encerrado com sucesso.",
      ...out,
      pendente: 0,
    });
  } catch (error) {
    const status = error?.status || 500;
    return res.status(status).json({ message: error?.message || "Erro ao fechar pedido (balcão)" });
  }
};

/* =========================
   ENVIAR PIX VIA BOT (WhatsApp) - balcão
========================= */
exports.enviarPixWhatsappBalcao = async (req, res) => {
  try {
    const { pedidoId } = req.params;
    const { numero, paymentId } = req.body;

    const soDigitos = String(numero || "").replace(/\D/g, "");
    if (!soDigitos || soDigitos.length < 10) {
      return res.status(400).json({ message: "Número inválido. Envie com DDD (ex: 81999999999)." });
    }

    let numeroFinal = soDigitos;
    if (!numeroFinal.startsWith("55") && (numeroFinal.length === 10 || numeroFinal.length === 11)) {
      numeroFinal = `55${numeroFinal}`;
    }

    const pedido =
      req.role === "garcom"
        ? await assertPedidoDoRestaurante(req, pedidoId)
        : await Pedido.findById(pedidoId);

    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado." });

    const restauranteId = String(pedido.restaurante);
    const conectado = estaConectado(restauranteId);

    if (!conectado) {
      return res.status(409).json({
        message: "Bot não está conectado. Ligue/conecte o bot antes de enviar o PIX no WhatsApp.",
        code: "BOT_OFFLINE",
      });
    }

    const pagamentos = Array.isArray(pedido.pagamentos) ? pedido.pagamentos : [];

    let alvo = null;
    if (paymentId) {
      alvo = pagamentos.find((p) => String(p?.mpPaymentId || "") === String(paymentId)) || null;
    } else {
      for (let i = pagamentos.length - 1; i >= 0; i--) {
        const p = pagamentos[i];
        if (String(p?.metodo || "").toLowerCase() === "pix" && String(p?.status || "") === "pendente") {
          alvo = p;
          break;
        }
      }
    }

    if (!alvo) {
      return res.status(404).json({
        message: "Não encontrei um PIX pendente para enviar. Gere um PIX primeiro.",
        code: "PIX_PENDENTE_NAO_ENCONTRADO",
      });
    }

    const valorPix = Number(alvo.valor || 0);
    if (!valorPix || valorPix < 1) {
      return res.status(400).json({ message: "Valor do PIX precisa ser no mínimo R$ 1,00." });
    }

    const copiaCola = String(alvo.pixQrCode || "").trim();
    if (!copiaCola) {
      return res.status(409).json({
        message: "PIX gerado, mas o código copia/cola ainda não está disponível. Consulte o status primeiro.",
        code: "PIX_SEM_COPIA_COLA",
      });
    }

    const itensBody = deduplicarItensResumoWhats(extrairItensResumoBody(req.body));

    // Quando o app envia o carrinho no body, ele é a fonte mais confiável para o WhatsApp.
    // Isso evita mostrar item duplicado caso alguma versão antiga tenha somado o mesmo carrinho no pedido.
    const itensResumo = itensBody.length ? itensBody : deduplicarItensResumoWhats(Array.isArray(pedido.itens) ? pedido.itens : []);
    const totalResumo = itensBody.length ? totalItensBalcao(itensBody) : 0;

    if (itensBody.length) {
      pedido.itens = itensBody;
      pedido.valorTotal = totalResumo;
      pedido.total = totalResumo;
      pedido.valorPendente = round2(Math.max(0, totalResumo - toNum(pedido.valorPago)));
    }

    const { total, pago, pendente } = recalcPagamentoPedido(pedido);
    await pedido.save().catch(() => {});

    const nomeCliente = pedido?.nomeCliente || req.body?.nomeCliente || req.body?.cliente || "Cliente";
    const qrBase64 = String(alvo.pixQrCodeBase64 || "").trim();

    const pedidoParaResumo = {
      ...(typeof pedido.toObject === "function" ? pedido.toObject() : pedido),
      itens: itensResumo,
      valorTotal: totalResumo || total,
      total: totalResumo || total,
    };
    const resumoItens = montarResumoItensPedido(pedidoParaResumo);

    const totalMensagem = totalResumo || total || valorPix;
    const pendenteMensagem = itensBody.length ? valorPix : pendente;

    const resumo = [
      "📲 *PAGAMENTO VIA PIX*",
      `👤 *Cliente:* ${nomeCliente}`,
      "",
      resumoItens,
      "",
      `💰 *Valor do PIX:* ${formatBRL(valorPix)}`,
      `🧾 *Total:* ${formatBRL(totalMensagem || 0)}`,
      `✅ *Pago:* ${formatBRL(pago || 0)}`,
      `⏳ *Pendente:* ${formatBRL(pendenteMensagem || 0)}`,
      "",
      "Abra o app do banco e escaneie o QR ✅",
    ].join("\n");

    alvo.whatsappPixNumero = numeroFinal;
    alvo.whatsappPixEnviadoEm = new Date();
    pedido.telefoneCliente = pedido.telefoneCliente || numeroFinal;
    await pedido.save().catch(() => {});

    if (qrBase64) await enviarMensagemMidia(restauranteId, numeroFinal, qrBase64, resumo);
    else await enviarMensagem(restauranteId, numeroFinal, resumo);

    await enviarMensagem(restauranteId, numeroFinal, "📋 *PIX Copia e Cola:*");
    await enviarMensagem(restauranteId, numeroFinal, copiaCola);
    await enviarMensagem(restauranteId, numeroFinal, "⚠️ *Após pagar, aguarde a confirmação.*");

    return res.json({
      ok: true,
      message: "Mensagem PIX enviada no WhatsApp pelo bot (em partes).",
      numero: numeroFinal,
      paymentId: String(alvo?.mpPaymentId || ""),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Erro ao enviar PIX pelo WhatsApp (bot) - balcão.",
      error: error?.message,
    });
  }
};
