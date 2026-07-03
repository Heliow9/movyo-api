const { queryWithRetry } = require("../lib/mysqlRetry");

const CANCELADOS = new Set(["cancelado", "cancelada", "canceled", "cancelled", "estornado", "expirado"]);
const PENDENTES = new Set(["pendente", "aguardando_pagamento", "pagamento_pendente", "error"]);
const PAGOS = new Set(["pago", "paid", "approved", "aprovado", "confirmado"]);
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const OPERATION_TIMEZONE = process.env.MOVYO_OPERATION_TIMEZONE || "America/Sao_Paulo";

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function normAscii(value) {
  return norm(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getOperationDateParts(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const text = value.trim();
    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
    const local = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (local && !hasTimezone) {
      return {
        year: Number(local[1]),
        month: Number(local[2]),
        day: Number(local[3]),
        hour: Number(local[4] || 0),
      };
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATION_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
  };
}

function isFreteItem(item = {}) {
  const nome = normAscii(item.nome || item.titulo || item.descricao || item.title || item.name || "");
  const tipo = normAscii(item.tipo || item.categoria || item.kind || "");
  return (
    tipo === "frete" ||
    tipo === "taxa entrega" ||
    tipo === "taxa de entrega" ||
    nome === "frete" ||
    nome === "entrega" ||
    nome === "taxa entrega" ||
    nome === "taxa de entrega" ||
    nome === "delivery fee"
  );
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sqlDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseReference(periodo, raw) {
  const now = new Date();
  if (periodo === "ano") {
    const year = Number(String(raw || now.getFullYear()).slice(0, 4)) || now.getFullYear();
    return new Date(year, 0, 1);
  }
  if (periodo === "mes") {
    const match = String(raw || "").match(/^(\d{4})-(\d{2})/);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const match = String(raw || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function getRange(periodo, referencia) {
  const ref = parseReference(periodo, referencia);
  const start = new Date(ref);
  let end;
  let previousStart;
  let label;

  if (periodo === "ano") {
    end = new Date(start.getFullYear() + 1, 0, 1);
    previousStart = new Date(start.getFullYear() - 1, 0, 1);
    label = String(start.getFullYear());
  } else if (periodo === "mes") {
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    previousStart = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    label = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  } else {
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
    label = start.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  }

  return {
    start,
    end,
    previousStart,
    previousEnd: start,
    label,
    referencia: periodo === "ano"
      ? String(start.getFullYear())
      : periodo === "mes"
        ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}`
        : `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
  };
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isSale(order) {
  const status = norm(order.status);
  const paymentStatus = norm(order.statusPagamento);
  if (CANCELADOS.has(status) || CANCELADOS.has(paymentStatus)) return false;
  if (PAGOS.has(paymentStatus)) return true;
  return !PENDENTES.has(status) && !PENDENTES.has(paymentStatus);
}

function netTotal(order) {
  return Math.max(0, Number(order.total || 0) - Number(order.valorCancelado || 0));
}

function metricas(rows) {
  const vendas = rows.filter(isSale);
  const faturamento = round2(vendas.reduce((sum, order) => sum + netTotal(order), 0));
  const pedidos = vendas.length;
  const cancelamentos = rows.filter(
    (order) => CANCELADOS.has(norm(order.status)) || CANCELADOS.has(norm(order.statusPagamento))
  ).length;
  return {
    faturamento,
    pedidos,
    ticketMedio: pedidos ? round2(faturamento / pedidos) : 0,
    cancelamentos,
    taxaCancelamento: rows.length ? round2((cancelamentos / rows.length) * 100) : 0,
  };
}

function delta(current, previous) {
  if (!previous) return current ? 100 : 0;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

function createSeries(periodo, range) {
  if (periodo === "ano") {
    return Array.from({ length: 12 }, (_, index) => ({
      chave: index,
      label: MESES[index],
      faturamento: 0,
      pedidos: 0,
    }));
  }
  if (periodo === "mes") {
    const days = new Date(range.start.getFullYear(), range.start.getMonth() + 1, 0).getDate();
    return Array.from({ length: days }, (_, index) => ({
      chave: index + 1,
      label: pad(index + 1),
      faturamento: 0,
      pedidos: 0,
    }));
  }
  return Array.from({ length: 24 }, (_, index) => ({
    chave: index,
    label: `${pad(index)}h`,
    faturamento: 0,
    pedidos: 0,
  }));
}

function bucketIndex(periodo, order) {
  const parts = getOperationDateParts(order.criadoEm || order.created_at);
  if (!parts) return -1;
  if (periodo === "ano") return parts.month - 1;
  if (periodo === "mes") return parts.day - 1;
  return parts.hour;
}

function groupLabel(value, kind) {
  const key = norm(value).replace(/[\s-]+/g, "_");
  if (kind === "origem") {
    if (["vitrine", "delivery", "site", "web"].includes(key)) return "Delivery";
    if (["balcao", "balcão"].includes(key)) return "Balcão";
    if (["mesa", "garcom", "garçom", "salao", "salão"].includes(key)) return "Salão";
    if (key.includes("ifood")) return "iFood";
    return value || "Outros";
  }
  if (key.includes("pix")) return "Pix";
  if (key.includes("credito")) return "Crédito";
  if (key.includes("debito")) return "Débito";
  if (key.includes("dinheiro")) return "Dinheiro";
  if (key.includes("online") || key.includes("mercado")) return "Online";
  return value || "Outros";
}

async function loadOrders(restauranteId, start, end) {
  const [rows] = await queryWithRetry(
    `SELECT id, numeroPedido, itens, total, valorCancelado, status, statusPagamento,
            formaPagamento, origem, nomeCliente, telefoneCliente, criadoEm, pagoEm,
            emProducaoEm, emEntregaEm, entregueEm
       FROM pedidos
      WHERE restaurante = ?
        AND criadoEm >= ?
        AND criadoEm < ?
      ORDER BY criadoEm ASC`,
    [String(restauranteId), sqlDate(start), sqlDate(end)],
    { label: "resumo.operacao" }
  );
  return rows || [];
}

exports.obter = async (req, res) => {
  try {
    const restauranteId = String(req.params.restauranteId || "");
    if (!restauranteId || String(req.restauranteId || "") !== restauranteId) {
      return res.status(403).json({ message: "Restaurante não autorizado." });
    }

    const periodo = ["dia", "mes", "ano"].includes(String(req.query.periodo))
      ? String(req.query.periodo)
      : "dia";
    const range = getRange(periodo, req.query.referencia);
    const [rows, previousRows] = await Promise.all([
      loadOrders(restauranteId, range.start, range.end),
      loadOrders(restauranteId, range.previousStart, range.previousEnd),
    ]);

    const resumo = metricas(rows);
    const anterior = metricas(previousRows);
    const serie = createSeries(periodo, range);
    const pagamentos = new Map();
    const origens = new Map();
    const produtos = new Map();

    rows.filter(isSale).forEach((order) => {
      const index = bucketIndex(periodo, order);
      if (serie[index]) {
        serie[index].faturamento = round2(serie[index].faturamento + netTotal(order));
        serie[index].pedidos += 1;
      }

      const pagamento = groupLabel(order.formaPagamento, "pagamento");
      pagamentos.set(pagamento, round2((pagamentos.get(pagamento) || 0) + netTotal(order)));
      const origem = groupLabel(order.origem, "origem");
      origens.set(origem, (origens.get(origem) || 0) + 1);

      parseJson(order.itens, []).forEach((item) => {
        if (isFreteItem(item)) return;
        const nome = String(item.nome || item.titulo || item.descricao || "Item");
        const quantidade = Math.max(1, Number(item.quantidade || item.qtd || 1) || 1);
        const total = Number(item.precoTotal ?? item.total ?? item.subtotal ?? 0) ||
          Number(item.precoUnitario ?? item.preco ?? 0) * quantidade;
        const current = produtos.get(nome) || { nome, quantidade: 0, faturamento: 0 };
        current.quantidade += quantidade;
        current.faturamento = round2(current.faturamento + total);
        produtos.set(nome, current);
      });
    });

    const pico = [...serie].sort((a, b) => b.pedidos - a.pedidos || b.faturamento - a.faturamento)[0];
    return res.json({
      periodo: {
        tipo: periodo,
        referencia: range.referencia,
        label: range.label,
        inicio: sqlDate(range.start),
        fim: sqlDate(range.end),
      },
      resumo,
      comparacao: {
        faturamento: delta(resumo.faturamento, anterior.faturamento),
        pedidos: delta(resumo.pedidos, anterior.pedidos),
        ticketMedio: delta(resumo.ticketMedio, anterior.ticketMedio),
        cancelamentos: delta(resumo.cancelamentos, anterior.cancelamentos),
        taxaCancelamento: delta(resumo.taxaCancelamento, anterior.taxaCancelamento),
        anterior,
      },
      serie,
      pagamentos: [...pagamentos.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor),
      origens: [...origens.entries()].map(([nome, pedidos]) => ({ nome, pedidos })).sort((a, b) => b.pedidos - a.pedidos),
      topProdutos: [...produtos.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 8),
      insights: {
        pico: pico?.pedidos ? { label: pico.label, pedidos: pico.pedidos, faturamento: pico.faturamento } : null,
        melhorProduto: [...produtos.values()].sort((a, b) => b.faturamento - a.faturamento)[0] || null,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao gerar o resumo da operação.", error: error.message });
  }
};
