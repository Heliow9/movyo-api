// src/components/ModalProduto.jsx
import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  TextField,
  FormControlLabel,
  Checkbox,
  RadioGroup,
  Radio,
  Box,
  Alert,
  Snackbar,
  IconButton,
  Divider,
  Stack,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";

const DEFAULT_IMAGE_URL =
  "https://cdn-icons-png.flaticon.com/512/1404/1404945.png";

const CART_KEY = "carrinho";
const CART_OWNER_KEY = "carrinho_restaurante_id"; // ✅ dono do carrinho (restaurante)

function parseMoney(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d,.-]/g, "");
    const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getItemBasePrice(item = {}) {
  return parseMoney(
    item.precoBase ??
      item.preco ??
      item.valor ??
      item.precoFinal ??
      item.price ??
      item.amount ??
      item.valorUnitario
  );
}

function formatBRL(value) {
  const num = parseMoney(value);
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isPizzaProduto(produto) {
  if (!produto) return false;
  if (produto.categoriaType === "pizza") return true;
  if (produto.pizzaMultisabor === true) return true;
  if (produto.permiteSabores === true) return true;
  if ((produto.saboresDisponiveis || []).length > 0) return true;
  return false;
}

// ✅ pega restaurante atual do localStorage (mesmo padrão do seu Checkout)
function getRestauranteAtual() {
  try {
    const raw = JSON.parse(localStorage.getItem("restauranteSelecionado") || "null");
    return raw?.restaurante ?? raw;
  } catch {
    return null;
  }
}

function readCart() {
  try {
    const arr = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(Array.isArray(items) ? items : []));
}

const ModalProduto = ({ open, onClose, produto }) => {
  const [saboresSelecionados, setSaboresSelecionados] = useState([]);
  const [bordaSelecionada, setBordaSelecionada] = useState("nenhum");
  const [complementosSelecionados, setComplementosSelecionados] = useState([]);
  const [adicionalSelecionado, setAdicionalSelecionado] = useState("nenhum");
  const [tiposExtrasSelecionados, setTiposExtrasSelecionados] = useState({});
  const [observacao, setObservacao] = useState("");
  const [quantidade, setQuantidade] = useState(1);
  const [validationError, setValidationError] = useState("");
  const [showSnackbar, setShowSnackbar] = useState(false);

  const isPizza = isPizzaProduto(produto);
  const saboresDisp = produto?.saboresDisponiveis || [];

  const maxSabores = useMemo(() => {
    if (!produto) return 1;

    const ms = Number(produto.maxSabores);
    if (Number.isFinite(ms) && ms > 0) return ms;

    if (produto.pizzaMultisabor) return 2;

    return 1;
  }, [produto]);

  const isPizzaMultiSabor = isPizza && maxSabores > 1;

  useEffect(() => {
    if (!open || !produto) return;

    setSaboresSelecionados([]);
    setBordaSelecionada("nenhum");
    setComplementosSelecionados([]);
    setAdicionalSelecionado("nenhum");
    setTiposExtrasSelecionados({});
    setObservacao("");
    setQuantidade(1);
    setValidationError("");

    if (isPizza && maxSabores === 1 && saboresDisp.length === 1) {
      setSaboresSelecionados([saboresDisp[0].nome]);
    }

    const autoSelectExtras = {};
    produto?.tiposExtras?.forEach((tipo) => {
      if (tipo.tipoSelecion === "unico" && tipo.itens?.length === 1) {
        autoSelectExtras[tipo.nome] = [tipo.itens[0]];
      }
      if (tipo.tipoSelecion === "multiplo" && tipo.obrigatorio && tipo.minimoSelecionados > 0) {
        autoSelectExtras[tipo.nome] = tipo.itens?.slice(0, tipo.minimoSelecionados) || [];
      }
    });
    setTiposExtrasSelecionados(autoSelectExtras);
  }, [open, produto, isPizza, maxSabores, saboresDisp.length]);

  const precoTotal = useMemo(() => {
    if (!produto) return 0;

    let total = getItemBasePrice(produto);

    if (isPizza && saboresSelecionados.length > 0) {
      const precos = saboresSelecionados
        .map((nome) => {
          const sabor = saboresDisp.find((s) => s.nome === nome);
          return getItemBasePrice(sabor);
        })
        .filter((v) => Number.isFinite(v));

      if (precos.length > 0) {
        const regra = produto.calculoPrecoPor || "maior";
        if (regra === "media") {
          const soma = precos.reduce((acc, v) => acc + v, 0);
          total = soma / precos.length;
        } else {
          total = Math.max(...precos);
        }
      }
    }

    if (bordaSelecionada !== "nenhum") {
      const borda = produto.bordasDisponiveis?.find((b) => b.nome === bordaSelecionada);
      total += getItemBasePrice(borda);
    }

    if (adicionalSelecionado !== "nenhum") {
      const adicional = produto.adicionais?.find((a) => a.nome === adicionalSelecionado);
      total += getItemBasePrice(adicional);
    }

    complementosSelecionados.forEach((nome) => {
      const comp = produto.complementos?.find((c) => c.nome === nome);
      total += getItemBasePrice(comp);
    });

    Object.entries(tiposExtrasSelecionados).forEach(([, itens]) => {
      if (Array.isArray(itens)) {
        for (const item of itens) total += getItemBasePrice(item);
      }
    });

    total *= quantidade;
    return Number.isFinite(total) ? total : 0;
  }, [
    produto,
    isPizza,
    saboresSelecionados,
    saboresDisp,
    bordaSelecionada,
    adicionalSelecionado,
    complementosSelecionados,
    tiposExtrasSelecionados,
    quantidade,
  ]);

  if (!produto) return null;

  const validate = () => {
    if (isPizza) {
      if (maxSabores > 1) {
        if (saboresSelecionados.length !== maxSabores) {
          return `Selecione exatamente ${maxSabores} sabor(es).`;
        }
      } else {
        if (saboresDisp.length >= 1 && saboresSelecionados.length !== 1) {
          return "Selecione o sabor da pizza.";
        }
      }
    }

    const tipos = produto.tiposExtras || [];
    for (const tipo of tipos) {
      const selecionados = tiposExtrasSelecionados[tipo.nome] || [];
      if (tipo.obrigatorio && selecionados.length === 0) {
        return `Selecione pelo menos uma opção em "${tipo.nome}".`;
      }
      if (tipo.minimoSelecionados && selecionados.length < tipo.minimoSelecionados) {
        return `Selecione pelo menos ${tipo.minimoSelecionados} opção(ões) em "${tipo.nome}".`;
      }
      if (tipo.maximoSelecionados && selecionados.length > tipo.maximoSelecionados) {
        return `Você pode escolher no máximo ${tipo.maximoSelecionados} opção(ões) em "${tipo.nome}".`;
      }
    }

    return "";
  };

  const handleAddToCart = () => {
    const errorMessage = validate();
    if (errorMessage) {
      setValidationError(errorMessage);
      return;
    }

    // ✅ restaurante atual (pra não misturar carrinho)
    const rest = getRestauranteAtual();
    const restId = rest?._id || null;

    // ✅ se trocou de restaurante, zera carrinho automaticamente
    const owner = String(localStorage.getItem(CART_OWNER_KEY) || "");
    let carrinhoAtual = readCart();

    if (restId) {
      // se já tem dono e é diferente -> zera
      if (owner && owner !== restId) {
        carrinhoAtual = [];
        localStorage.removeItem("pix_pendente"); // opcional: evita pix pendente de outra loja
      }
      // se carrinho antigo sem owner -> zera (pra não vazar pra outra loja)
      if (!owner && carrinhoAtual.length > 0) {
        carrinhoAtual = [];
        localStorage.removeItem("pix_pendente");
      }

      localStorage.setItem(CART_OWNER_KEY, restId);
    }

    const pedido = {
      produtoId: produto._id,
      nome: produto.nome,
      imagem: produto.imagem,
      categoriaType: isPizza ? "pizza" : produto.categoriaType || "simple_item",

      // ✅ amarra item ao restaurante
      restauranteId: restId,

      // pizza
      pizzaMultisabor: Boolean(produto.pizzaMultisabor),
      calculoPrecoPor: produto.calculoPrecoPor || "maior",
      maxSabores,
      saboresSelecionados,

      // borda/adicional/complementos
      bordaSelecionada:
        bordaSelecionada === "nenhum"
          ? null
          : produto.bordasDisponiveis?.find((b) => b.nome === bordaSelecionada),
      adicionalSelecionado:
        adicionalSelecionado === "nenhum"
          ? null
          : produto.adicionais?.find((a) => a.nome === adicionalSelecionado),
      complementosSelecionados:
        produto.complementos?.filter((c) => complementosSelecionados.includes(c.nome)) || [],

      tiposExtrasSelecionados,
      observacao,
      quantidade,

      // preços
      precoUnitario: getItemBasePrice(produto),
      precoTotal: Number(precoTotal || 0),
    };

    carrinhoAtual.push(pedido);
    writeCart(carrinhoAtual);

    setShowSnackbar(true);
    onClose();
  };

  const mostrarPrecoBasePizza = isPizza && saboresDisp.length > 1;
  const precoPizzaAPartir = mostrarPrecoBasePizza
    ? (() => {
        const min = saboresDisp.reduce((menor, s) => {
          const p = getItemBasePrice(s) || Number.POSITIVE_INFINITY;
          return Math.min(menor, p);
        }, Number.POSITIVE_INFINITY);

        if (!isFinite(min)) return getItemBasePrice(produto);
        return min;
      })()
    : getItemBasePrice(produto);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        scroll="paper"
        PaperProps={{
          sx: {
            borderRadius: { xs: "18px 18px 0 0", sm: 3 },
            position: { xs: "fixed", sm: "relative" },
            bottom: { xs: 0, sm: "auto" },
            m: { xs: 0, sm: 2 },
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pb: 1,
          }}
        >
          <Typography
            variant="subtitle1"
            fontWeight={700}
            sx={{ pr: 2, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {produto.nome}
          </Typography>
          <IconButton edge="end" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ pt: 2 }}>
          {/* Imagem */}
          <Box sx={{ mb: 2, borderRadius: 2, overflow: "hidden", position: "relative" }}>
            <Box
              component="img"
              src={produto.imagem || DEFAULT_IMAGE_URL}
              alt={produto.nome}
              sx={{ width: "100%", height: 180, objectFit: "cover", display: "block" }}
            />
          </Box>

          {/* Descrição + preço base */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {produto.descricao}
            </Typography>

            <Stack direction="row" alignItems="baseline" spacing={1}>
              <Typography variant="h6" fontWeight={700} color="primary">
                {mostrarPrecoBasePizza ? "a partir de " : ""}
                {formatBRL(precoPizzaAPartir)}
              </Typography>
            </Stack>
          </Box>

          {/* Alertas */}
          {validationError && (
            <Alert severity="warning" onClose={() => setValidationError("")} sx={{ mb: 2 }}>
              {validationError}
            </Alert>
          )}

          {/* Sabores */}
          {isPizza && saboresDisp.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                Sabores {isPizzaMultiSabor ? `(escolha exatamente ${maxSabores})` : ""}
              </Typography>

              {maxSabores === 1 ? (
                <RadioGroup
                  value={saboresSelecionados[0] || ""}
                  onChange={(e) => setSaboresSelecionados(e.target.value ? [e.target.value] : [])}
                >
                  {saboresDisp.map((s, i) => (
                    <FormControlLabel
                      key={i}
                      value={s.nome}
                      control={<Radio />}
                      label={s.preco ? `${s.nome} (${formatBRL(s.preco)})` : s.nome}
                    />
                  ))}
                </RadioGroup>
              ) : (
                <Box display="flex" flexDirection="column">
                  {saboresDisp.map((s, i) => {
                    const checked = saboresSelecionados.includes(s.nome);
                    const desabilitado = !checked && saboresSelecionados.length >= maxSabores;

                    return (
                      <FormControlLabel
                        key={i}
                        control={
                          <Checkbox
                            checked={checked}
                            disabled={desabilitado}
                            onChange={() => {
                              if (checked) {
                                setSaboresSelecionados((prev) => prev.filter((n) => n !== s.nome));
                              } else if (saboresSelecionados.length < maxSabores) {
                                setSaboresSelecionados((prev) => [...prev, s.nome]);
                              }
                            }}
                          />
                        }
                        label={s.preco ? `${s.nome} (${formatBRL(s.preco)})` : s.nome}
                      />
                    );
                  })}
                </Box>
              )}
            </Box>
          )}

          {/* Bordas */}
          {produto.bordasDisponiveis?.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography fontWeight="bold" gutterBottom>
                Borda
              </Typography>
              <RadioGroup value={bordaSelecionada} onChange={(e) => setBordaSelecionada(e.target.value)}>
                <FormControlLabel value="nenhum" control={<Radio />} label="Sem borda" />
                {produto.bordasDisponiveis.map((b, i) => (
                  <FormControlLabel
                    key={i}
                    value={b.nome}
                    control={<Radio />}
                    label={`${b.nome} (+${formatBRL(b.preco)})`}
                  />
                ))}
              </RadioGroup>
            </Box>
          )}

          {/* Adicionais */}
          {produto.adicionais?.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography fontWeight="bold" gutterBottom>
                Adicional
              </Typography>
              <RadioGroup value={adicionalSelecionado} onChange={(e) => setAdicionalSelecionado(e.target.value)}>
                <FormControlLabel value="nenhum" control={<Radio />} label="Sem adicional" />
                {produto.adicionais.map((a, i) => (
                  <FormControlLabel
                    key={i}
                    value={a.nome}
                    control={<Radio />}
                    label={`${a.nome} (+${formatBRL(a.preco)})`}
                  />
                ))}
              </RadioGroup>
            </Box>
          )}

          {/* Tipos extras */}
          {produto.tiposExtras?.map((tipo, idx) => {
            if (!Array.isArray(tipo.itens) || tipo.itens.length === 0) return null;

            const selecionados = tiposExtrasSelecionados[tipo.nome] || [];

            return (
              <Box key={idx} sx={{ mt: 3 }}>
                <Typography fontWeight="bold" gutterBottom>
                  {tipo.nome} {tipo.obrigatorio && "*"}
                  {tipo.tipoSelecion === "multiplo" &&
                    tipo.maximoSelecionados &&
                    ` (até ${tipo.maximoSelecionados})`}
                </Typography>

                {tipo.tipoSelecion === "unico" ? (
                  <RadioGroup
                    value={selecionados[0]?.nome || ""}
                    onChange={(e) => {
                      const item = tipo.itens.find((i) => i.nome === e.target.value);
                      setTiposExtrasSelecionados((prev) => ({
                        ...prev,
                        [tipo.nome]: item ? [item] : [],
                      }));
                    }}
                  >
                    {!tipo.obrigatorio && <FormControlLabel value="" control={<Radio />} label="Nenhum" />}
                    {tipo.itens.map((item, i) => (
                      <FormControlLabel
                        key={i}
                        value={item.nome}
                        control={<Radio />}
                        label={`${item.nome} (+${formatBRL(item.preco)})`}
                      />
                    ))}
                  </RadioGroup>
                ) : (
                  <Box display="flex" flexDirection="column" gap={1}>
                    {tipo.itens.map((item, i) => {
                      const isChecked = selecionados.some((s) => s.nome === item.nome);
                      const disabled =
                        !isChecked &&
                        tipo.maximoSelecionados !== undefined &&
                        selecionados.length >= tipo.maximoSelecionados;

                      return (
                        <FormControlLabel
                          key={i}
                          control={
                            <Checkbox
                              checked={isChecked}
                              disabled={disabled}
                              onChange={() => {
                                const novos = isChecked
                                  ? selecionados.filter((s) => s.nome !== item.nome)
                                  : [...selecionados, item];
                                setTiposExtrasSelecionados((prev) => ({
                                  ...prev,
                                  [tipo.nome]: novos,
                                }));
                              }}
                            />
                          }
                          label={`${item.nome} (+${formatBRL(item.preco)})`}
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>
            );
          })}

          {/* Complementos */}
          {produto.complementos?.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography fontWeight="bold" gutterBottom>
                Complementos
              </Typography>
              <Box display="flex" flexDirection="column">
                {produto.complementos.map((c, i) => {
                  const checked = complementosSelecionados.includes(c.nome);
                  return (
                    <FormControlLabel
                      key={i}
                      control={
                        <Checkbox
                          checked={checked}
                          onChange={() => {
                            setComplementosSelecionados((prev) =>
                              checked ? prev.filter((n) => n !== c.nome) : [...prev, c.nome]
                            );
                          }}
                        />
                      }
                      label={`${c.nome} (+${formatBRL(c.preco)})`}
                    />
                  );
                })}
              </Box>
            </Box>
          )}

          {/* Observações */}
          <TextField
            fullWidth
            multiline
            rows={2}
            label="Observações"
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            sx={{ mt: 3 }}
          />

          {/* Quantidade */}
          <Box display="flex" alignItems="center" justifyContent="space-between" sx={{ mt: 3 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              Quantidade
            </Typography>
            <Box display="flex" alignItems="center" gap={1.5}>
              <IconButton size="small" onClick={() => setQuantidade((q) => Math.max(1, q - 1))}>
                <RemoveIcon />
              </IconButton>
              <Typography>{quantidade}</Typography>
              <IconButton size="small" onClick={() => setQuantidade((q) => q + 1)}>
                <AddIcon />
              </IconButton>
            </Box>
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            flexDirection: "column",
            alignItems: "stretch",
            px: 2,
            pb: 2,
            pt: 1,
            borderTop: "1px solid #eee",
            position: "sticky",
            bottom: 0,
            backgroundColor: "#fff",
            zIndex: 2,
          }}
        >
          <Box mb={1} display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2" color="text.secondary">
              Total
            </Typography>
            <Typography variant="h6" fontWeight="bold" color="primary">
              {formatBRL(precoTotal)}
            </Typography>
          </Box>

          <Box display="flex" gap={1}>
            <Button fullWidth onClick={onClose} variant="outlined" color="inherit">
              Cancelar
            </Button>
            <Button
              fullWidth
              onClick={handleAddToCart}
              sx={{
                background: "linear-gradient(90deg,#ff4b8b,#ff7a3d)",
                color: "#fff",
                fontWeight: "bold",
                borderRadius: "12px",
                "&:hover": {
                  opacity: 0.9,
                  background: "linear-gradient(90deg,#ff4b8b,#ff7a3d)",
                },
              }}
            >
              Adicionar
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={showSnackbar}
        autoHideDuration={3000}
        onClose={() => setShowSnackbar(false)}
        message="Produto adicionado com sucesso!"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );
};

export default ModalProduto;
