const CANCELED_STATUSES = new Set([
  "cancelado",
  "cancelada",
  "canceled",
  "cancelled",
]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function toMoneyNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  if (typeof value === "object") {
    const decimal = value.$numberDecimal ?? value.value ?? value.amount;
    if (decimal !== undefined && decimal !== value) return toMoneyNumber(decimal);
  }

  let text = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^0-9,.-]/g, "");

  if (!text || text === "-" || text === "," || text === ".") return 0;

  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstDefinedMoney(values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    return toMoneyNumber(value);
  }
  return null;
}

function itemQuantity(item) {
  const quantity = Number(item?.quantidade ?? item?.qtd ?? item?.quantity ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function itemTotal(item) {
  const explicitTotal = firstDefinedMoney([
    item?.precoTotal,
    item?.total,
    item?.valorTotal,
    item?.subtotal,
    item?.valorItemTotal,
  ]);
  const unit = firstDefinedMoney([
    item?.precoUnitario,
    item?.preco,
    item?.valorUnitario,
    item?.valor,
    item?.price,
  ]);

  if (explicitTotal !== null && explicitTotal > 0) return explicitTotal;
  if (unit !== null && unit > 0) return unit * itemQuantity(item);
  return explicitTotal ?? 0;
}

function sumItems(items) {
  return (Array.isArray(items) ? items : [])
    .reduce((total, item) => total + itemTotal(item?.item || item), 0);
}

function isCanceledOrder(pedido) {
  return CANCELED_STATUSES.has(normalizeStatus(pedido?.status));
}

function pickPedidoTotal(pedido = {}) {
  const currentTotal = firstDefinedMoney([
    pedido.total,
    pedido.valorTotal,
    pedido.valor,
    pedido.subtotal,
  ]);
  const currentItemsTotal = sumItems(
    Array.isArray(pedido.itens) ? pedido.itens : pedido.items
  );

  if (!isCanceledOrder(pedido)) {
    if (currentTotal !== null && currentTotal > 0) return currentTotal;
    if (currentItemsTotal > 0) return currentItemsTotal;
    return currentTotal ?? 0;
  }

  const snapshot = pedido.pedidoOriginalSnapshot || {};
  const snapshotTotal = firstDefinedMoney([
    snapshot.total,
    snapshot.valorTotal,
    snapshot.valor,
    snapshot.subtotal,
  ]);
  const snapshotItemsTotal = sumItems(snapshot.itens);
  const canceledTotal = firstDefinedMoney([
    pedido.valorCancelado,
    pedido.estornoValor,
  ]);
  const canceledItemsTotal = sumItems(pedido.itensCancelados);

  if (snapshotTotal !== null && snapshotTotal > 0) return snapshotTotal;
  if (snapshotItemsTotal > 0) return snapshotItemsTotal;
  if (canceledTotal !== null && canceledTotal > 0) return canceledTotal;
  if (canceledItemsTotal > 0) return canceledItemsTotal;
  if (currentTotal !== null && currentTotal > 0) return currentTotal;
  if (currentItemsTotal > 0) return currentItemsTotal;
  return currentTotal ?? canceledTotal ?? snapshotTotal ?? 0;
}

function canceledItemFromLog(entry = {}) {
  return {
    ...(entry?.item || entry),
    _cancelado: true,
    _cancelamento: entry,
  };
}

function pickPedidoItems(pedido = {}) {
  const currentItems = Array.isArray(pedido.itens)
    ? pedido.itens
    : Array.isArray(pedido.items)
      ? pedido.items
      : [];
  const canceledItems = (Array.isArray(pedido.itensCancelados)
    ? pedido.itensCancelados
    : []
  ).map(canceledItemFromLog);

  if (currentItems.length || canceledItems.length) {
    return [...currentItems, ...canceledItems];
  }

  if (isCanceledOrder(pedido) && Array.isArray(pedido?.pedidoOriginalSnapshot?.itens)) {
    return pedido.pedidoOriginalSnapshot.itens.map((item) => ({
      ...item,
      _cancelado: true,
    }));
  }

  return [];
}

module.exports = {
  isCanceledOrder,
  itemTotal,
  pickPedidoItems,
  pickPedidoTotal,
  sumItems,
  toMoneyNumber,
};
