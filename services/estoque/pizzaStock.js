function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function getProductId(item = {}) {
  const raw =
    item.produtoId ||
    item.produto?._id ||
    item.produto?.id ||
    item.produto ||
    item.productId ||
    item.idProduto ||
    item._id ||
    item.id;
  return String(raw || "");
}

function getOptionName(option) {
  if (typeof option === "string") return option;
  return option?.nome || option?.name || option?.titulo || option?.title || "";
}

function getOptionId(option) {
  if (typeof option === "string") return "";
  return String(option?._id || option?.id || option?.opcaoId || "");
}

function getRecipeId(source = {}) {
  return String(
    source?.receitaId ||
      source?.receita?._id ||
      source?.receita?.id ||
      source?.receita ||
      source?.recipeId ||
      ""
  );
}

function optionCatalog(product = {}) {
  const extras = product.extras && typeof product.extras === "object"
    ? Object.values(product.extras).flatMap(asArray)
    : [];
  return [
    ...asArray(product.sabores),
    ...asArray(product.bordas),
    ...asArray(product.adicionais),
    ...asArray(product.complementos),
    ...extras,
  ];
}

function findOption(product, selected, preferredKey) {
  const preferred = asArray(product?.[preferredKey]);
  const catalog = preferred.length ? preferred : optionCatalog(product);
  const selectedId = getOptionId(selected);
  const selectedName = normalizeKey(getOptionName(selected));
  return catalog.find((candidate) => {
    const candidateId = getOptionId(candidate);
    const candidateName = normalizeKey(getOptionName(candidate));
    return (selectedId && candidateId && selectedId === candidateId) ||
      (selectedName && candidateName && selectedName === candidateName);
  }) || null;
}

function addRecipe(target, recipeId, multiplier, detail) {
  const id = String(recipeId || "");
  const value = Number(multiplier || 0);
  if (!id || !Number.isFinite(value) || value <= 0) return;
  const current = target.get(id) || { receitaId: id, multiplicador: 0, detalhes: [] };
  current.multiplicador += value;
  current.detalhes.push(detail);
  target.set(id, current);
}

function flattenExtraSelections(item = {}) {
  const grupos = item.tiposExtrasSelecionados;
  if (!grupos || typeof grupos !== "object") return [];
  return Object.values(grupos).flatMap(asArray);
}

function buildRecipeMultipliers({ itensPedido = [], produtos = [] } = {}) {
  const productMap = new Map(
    asArray(produtos).map((product) => [String(product?._id || product?.id || ""), product])
  );
  const receitas = new Map();
  const avisos = [];

  for (const item of asArray(itensPedido)) {
    const produtoId = getProductId(item);
    const product = productMap.get(produtoId);
    if (!product) {
      avisos.push({ codigo: "produto_nao_encontrado", produtoId });
      continue;
    }

    const quantidade = Math.max(1, Number(item.quantidade || item.qtd || item.quantity || 1) || 1);
    const pizzaConfig = product.estoquePizza && typeof product.estoquePizza === "object"
      ? product.estoquePizza
      : {};
    const baseRecipeId = String(pizzaConfig.receitaBaseId || getRecipeId(product) || "");

    if (baseRecipeId) {
      addRecipe(receitas, baseRecipeId, quantidade, {
        tipo: "base",
        produtoId,
        produtoNome: product.nome,
        quantidade,
      });
    }

    const isPizza = String(product.tipoItem || product.tipo || "").toLowerCase() === "pizza" ||
      product.pizzaMultisabor === true;
    const saboresSelecionados = asArray(item.saboresSelecionados?.length ? item.saboresSelecionados : item.sabores);

    if (isPizza && saboresSelecionados.length) {
      const explicitFractions = saboresSelecionados.map((selected) =>
        Number(typeof selected === "object" ? selected.fracao ?? selected.fraction : NaN)
      );
      const hasCompleteExplicitFractions = explicitFractions.every(
        (value) => Number.isFinite(value) && value > 0
      );
      const explicitTotal = explicitFractions.reduce(
        (sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0),
        0
      );

      saboresSelecionados.forEach((selected, index) => {
        const option = findOption(product, selected, "sabores");
        const recipeId = getRecipeId(option || {});
        const explicit = explicitFractions[index];
        const fracao = hasCompleteExplicitFractions
          ? explicit / explicitTotal
          : 1 / saboresSelecionados.length;

        if (!option || !recipeId) {
          avisos.push({
            codigo: "sabor_sem_receita",
            produtoId,
            produtoNome: product.nome,
            opcao: getOptionName(selected),
          });
          return;
        }

        addRecipe(
          receitas,
          recipeId,
          quantidade * (pizzaConfig.fracionarSabores === false ? 1 : fracao),
          {
            tipo: "sabor",
            produtoId,
            produtoNome: product.nome,
            opcao: getOptionName(option),
            fracao: pizzaConfig.fracionarSabores === false ? 1 : fracao,
            quantidade,
          }
        );
      });
    }

    const optionGroups = [
      { key: "bordas", values: asArray(item.bordaSelecionada || item.borda) },
      {
        key: "adicionais",
        values: [
          ...asArray(item.adicionalSelecionado || item.adicional),
          ...asArray(item.adicionaisSelecionados),
          ...asArray(item.adicionais),
        ],
      },
      {
        key: "complementos",
        values: [
          ...asArray(item.complementosSelecionados),
          ...asArray(item.complementos),
        ],
      },
      { key: "extras", values: flattenExtraSelections(item) },
    ];

    const processed = new Set();
    optionGroups.forEach(({ key, values }) => {
      values.forEach((selected) => {
        const signature = `${key}:${getOptionId(selected) || normalizeKey(getOptionName(selected))}`;
        if (!signature || processed.has(signature)) return;
        processed.add(signature);

        const option = findOption(product, selected, key);
        const recipeId = getRecipeId(option || {});
        if (!recipeId) return;
        const optionQty = Math.max(1, Number(selected?.quantidade || selected?.qtd || 1) || 1);
        addRecipe(receitas, recipeId, quantidade * optionQty, {
          tipo: key === "extras" ? "extra" : key.replace(/s$/, ""),
          produtoId,
          produtoNome: product.nome,
          opcao: getOptionName(option),
          quantidade: quantidade * optionQty,
        });
      });
    });
  }

  return { receitas: [...receitas.values()], avisos };
}

module.exports = {
  buildRecipeMultipliers,
  normalizeKey,
  getProductId,
};
