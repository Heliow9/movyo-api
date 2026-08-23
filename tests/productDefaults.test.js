const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_PRODUCT_IMAGE_URL,
  withDefaultProductImage,
  isExtraPaused,
  filterAvailableExtras,
} = require("../utils/productDefaults");

test("aplica a imagem padrão somente quando o produto não tem imagem", () => {
  assert.equal(withDefaultProductImage(""), DEFAULT_PRODUCT_IMAGE_URL);
  assert.equal(withDefaultProductImage("   "), DEFAULT_PRODUCT_IMAGE_URL);
  assert.equal(withDefaultProductImage(null), DEFAULT_PRODUCT_IMAGE_URL);
  assert.equal(withDefaultProductImage(" https://cdn.exemplo/item.jpg "), "https://cdn.exemplo/item.jpg");
});

test("reconhece extras pausados e mantém somente os disponíveis na vitrine", () => {
  assert.equal(isExtraPaused({ pausado: true }), true);
  assert.equal(isExtraPaused({ ativo: false }), true);
  assert.equal(isExtraPaused({ disponivel: false }), true);
  assert.equal(isExtraPaused({ nome: "KitKat" }), false);

  assert.deepEqual(
    filterAvailableExtras({
      Coberturas: [
        { nome: "KitKat", pausado: true },
        { nome: "Ovomaltine", pausado: false },
      ],
    }),
    { Coberturas: [{ nome: "Ovomaltine", pausado: false }] }
  );
});
