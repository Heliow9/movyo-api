const DEFAULT_PRODUCT_IMAGE_URL =
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQSnC-p8pxkiH1VVPzbafjrFEoR8w9_mEA0tG9pzCL3QeRn-8X1Ni-blcs&s=10";

function withDefaultProductImage(value) {
  const image = String(value || "").trim();
  return image || DEFAULT_PRODUCT_IMAGE_URL;
}

function isExtraPaused(item = {}) {
  return item?.pausado === true || item?.ativo === false || item?.disponivel === false;
}

function filterAvailableExtras(extras = {}) {
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return {};
  return Object.fromEntries(
    Object.entries(extras).map(([group, items]) => [
      group,
      Array.isArray(items) ? items.filter((item) => !isExtraPaused(item)) : [],
    ])
  );
}

module.exports = {
  DEFAULT_PRODUCT_IMAGE_URL,
  withDefaultProductImage,
  isExtraPaused,
  filterAvailableExtras,
};
