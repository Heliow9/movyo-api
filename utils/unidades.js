function toBase(qtd, unidade) {
  const n = Number(qtd || 0);
  if (unidade === "g") return { base: "kg", value: n / 1000 };
  if (unidade === "kg") return { base: "kg", value: n };
  if (unidade === "ml") return { base: "l", value: n / 1000 };
  if (unidade === "l") return { base: "l", value: n };
  if (unidade === "un") return { base: "un", value: n };
  return { base: unidade, value: n };
}

module.exports = { toBase };
