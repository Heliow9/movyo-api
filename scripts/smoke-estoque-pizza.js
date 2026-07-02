const assert = require("assert");
const { buildRecipeMultipliers } = require("../services/estoque/pizzaStock");

const product = {
  _id: "produto-pizza",
  nome: "Pizza grande",
  tipoItem: "pizza",
  pizzaMultisabor: true,
  receita: "receita-base",
  estoquePizza: { ativo: true, receitaBaseId: "receita-base", fracionarSabores: true },
  sabores: [
    { nome: "Calabresa", receitaId: "receita-calabresa" },
    { nome: "Frango", receitaId: "receita-frango" },
  ],
  bordas: [{ nome: "Catupiry", receitaId: "receita-borda" }],
};

const result = buildRecipeMultipliers({
  produtos: [product],
  itensPedido: [{
    produtoId: "produto-pizza",
    quantidade: 2,
    saboresSelecionados: ["Calabresa", "Frango"],
    bordaSelecionada: "Catupiry",
  }],
});

const byId = new Map(result.receitas.map((item) => [item.receitaId, item.multiplicador]));
assert.strictEqual(byId.get("receita-base"), 2, "A base deve ser consumida integralmente por pizza.");
assert.strictEqual(byId.get("receita-calabresa"), 1, "Duas pizzas meio sabor equivalem a uma receita inteira.");
assert.strictEqual(byId.get("receita-frango"), 1, "Duas pizzas meio sabor equivalem a uma receita inteira.");
assert.strictEqual(byId.get("receita-borda"), 2, "A borda deve ser consumida integralmente por pizza.");
assert.deepStrictEqual(result.avisos, []);

const threeFlavorProduct = {
  ...product,
  sabores: [
    ...product.sabores,
    { nome: "Marguerita", receitaId: "receita-marguerita" },
  ],
};
const threeFlavorResult = buildRecipeMultipliers({
  produtos: [threeFlavorProduct],
  itensPedido: [{
    produtoId: "produto-pizza",
    saboresSelecionados: ["Calabresa", "Frango", "Marguerita"],
  }],
});
const threeFlavorById = new Map(
  threeFlavorResult.receitas.map((item) => [item.receitaId, item.multiplicador])
);
assert.strictEqual(threeFlavorById.get("receita-base"), 1);
assert.ok(Math.abs(threeFlavorById.get("receita-calabresa") - (1 / 3)) < 1e-10);
assert.ok(Math.abs(threeFlavorById.get("receita-frango") - (1 / 3)) < 1e-10);
assert.ok(Math.abs(threeFlavorById.get("receita-marguerita") - (1 / 3)) < 1e-10);

const partialFractionResult = buildRecipeMultipliers({
  produtos: [product],
  itensPedido: [{
    produtoId: "produto-pizza",
    saboresSelecionados: [{ nome: "Calabresa", fracao: 0.5 }, "Frango"],
  }],
});
const partialFractionById = new Map(
  partialFractionResult.receitas.map((item) => [item.receitaId, item.multiplicador])
);
assert.strictEqual(partialFractionById.get("receita-calabresa"), 0.5);
assert.strictEqual(partialFractionById.get("receita-frango"), 0.5);

console.log("smoke-estoque-pizza: ok");
