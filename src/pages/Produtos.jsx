import React, { useEffect, useState, useRef } from "react";
import {
  Paper,
  Typography,
  Grid,
  TextField,
  Button,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Chip,
  IconButton,
  FormControlLabel,
  InputAdornment,
  Switch,
  Stack,
  Tooltip,
  Collapse,
} from "@mui/material";

import axios from "axios";
import { styled } from "@mui/system";

import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CategoryIcon from "@mui/icons-material/Category";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ImageIcon from "@mui/icons-material/Image";
import CloseIcon from "@mui/icons-material/Close";
import TuneIcon from "@mui/icons-material/Tune";

const API_URL = import.meta.env.VITE_API_URL || "https://api.movyo.delivery";

const MOCK_IMAGE =
  "https://cdn.pixabay.com/photo/2017/12/09/08/18/pizza-3007395_960_720.jpg";

const HiddenInput = styled("input")({ display: "none" });

export default function ProdutosTab({ handleSnackbar }) {
  const restauranteId = localStorage.getItem("_id");

  const [categorias, setCategorias] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [produtoDestaqueId, setProdutoDestaqueId] = useState(null);

  const produtoRefs = useRef({});
  const formRef = useRef(null);

  const [produtoForm, setProdutoForm] = useState({
    nome: "",
    descricao: "",
    precoBase: "", // centavos string
    imagem: null, // File
    imagemPreview: "",
    imagemUrl: "",
    categoria: "",
    sabores: [],
    bordas: [],
    adicionais: [],
    complementos: [],
    extras: {},
  });

  const [tempInputs, setTempInputs] = useState({
    sabores: { nome: "", preco: "" },
    bordas: { nome: "", preco: "" },
    adicionais: { nome: "", preco: "" },
    complementos: { nome: "", preco: "" },
    extras: {},
  });

  const [produtoEditandoId, setProdutoEditandoId] = useState(null);
  const [categoriaErro, setCategoriaErro] = useState(false);

  // filtros
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [mostrarSomenteInativos, setMostrarSomenteInativos] = useState(false);
  const [mostrarFiltros, setMostrarFiltros] = useState(true);

  useEffect(() => {
    fetchCategorias();
    fetchProdutos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCategorias = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/categorias/${restauranteId}`);
      setCategorias(res.data || []);
    } catch (e) {
      console.error(e);
      handleSnackbar("Erro ao carregar categorias", "error");
    }
  };

  const fetchProdutos = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/produtos/${restauranteId}`);
      const comImagem = (res.data || []).map((p) => ({
        ...p,
        imagem: p.imagem || MOCK_IMAGE,
      }));
      setProdutos(comImagem);
    } catch (e) {
      console.error(e);
      handleSnackbar("Erro ao carregar produtos", "error");
    }
  };

  const limparFormulario = () => {
    setProdutoForm({
      nome: "",
      descricao: "",
      precoBase: "",
      imagem: null,
      imagemPreview: "",
      imagemUrl: "",
      categoria: "",
      sabores: [],
      bordas: [],
      adicionais: [],
      complementos: [],
      extras: {},
    });

    setTempInputs({
      sabores: { nome: "", preco: "" },
      bordas: { nome: "", preco: "" },
      adicionais: { nome: "", preco: "" },
      complementos: { nome: "", preco: "" },
      extras: {},
    });

    setProdutoEditandoId(null);
    setCategoriaErro(false);
  };

  // preço (centavos -> BRL)
  const formatCurrency = (value) => {
    if (!value) return "";
    const cents = String(value).replace(/\D/g, "");
    const number = parseFloat(cents) / 100;
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProdutoForm((prev) => ({
      ...prev,
      imagem: file,
      imagemPreview: URL.createObjectURL(file),
      imagemUrl: "",
    }));
  };

  const removerImagemSelecionada = () => {
    setProdutoForm((prev) => ({ ...prev, imagem: null, imagemPreview: "" }));
  };

  const handleCreateProduto = async () => {
    if (!produtoForm.nome || !produtoForm.categoria || produtoForm.categoria === "none") {
      setCategoriaErro(true);
      handleSnackbar("Por favor, selecione uma categoria válida.", "warning");
      return;
    }

    const precoDecimal = (parseInt(String(produtoForm.precoBase || "0"), 10) / 100).toFixed(2);

    const data = new FormData();
    data.append("nome", produtoForm.nome);
    data.append("descricao", produtoForm.descricao || "");
    data.append("categoria", produtoForm.categoria);
    data.append("precoBase", precoDecimal);

    if (produtoForm.imagem) data.append("imagem", produtoForm.imagem);
    else {
      const img = produtoForm.imagemUrl?.trim() ? produtoForm.imagemUrl.trim() : MOCK_IMAGE;
      data.append("imagem", img);
    }

    data.append("sabores", JSON.stringify(produtoForm.sabores || []));
    data.append("bordas", JSON.stringify(produtoForm.bordas || []));
    data.append("adicionais", JSON.stringify(produtoForm.adicionais || []));
    data.append("complementos", JSON.stringify(produtoForm.complementos || []));
    data.append("extras", JSON.stringify(produtoForm.extras || {}));
    data.append("restaurante", restauranteId);

    try {
      if (produtoEditandoId) {
        await axios.put(`${API_URL}/api/produtos/${produtoEditandoId}`, data, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } else {
        await axios.post(`${API_URL}/api/produtos`, data, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      limparFormulario();
      await fetchProdutos();
      handleSnackbar(produtoEditandoId ? "Produto atualizado!" : "Produto cadastrado!");
    } catch (err) {
      console.error("Erro ao salvar produto:", err);
      handleSnackbar("Erro ao salvar produto", "error");
    }
  };

  const handleAddItem = (key, tipoExtra = null) => {
    if (tipoExtra) {
      const temp = tempInputs.extras[tipoExtra] || { nome: "", preco: "" };
      const precoFloat = Number(temp.preco.toString().replace(",", "."));
      if (!temp.nome || isNaN(precoFloat)) return;

      setProdutoForm((prev) => ({
        ...prev,
        extras: {
          ...prev.extras,
          [tipoExtra]: [...(prev.extras[tipoExtra] || []), { nome: temp.nome, preco: precoFloat }],
        },
      }));

      setTempInputs((prev) => ({
        ...prev,
        extras: { ...prev.extras, [tipoExtra]: { nome: "", preco: "" } },
      }));
      return;
    }

    const temp = tempInputs[key];
    const precoFloat = Number(temp.preco.toString().replace(",", "."));
    if (!temp.nome || isNaN(precoFloat)) return;

    setProdutoForm((prev) => ({ ...prev, [key]: [...prev[key], { nome: temp.nome, preco: precoFloat }] }));
    setTempInputs((prev) => ({ ...prev, [key]: { nome: "", preco: "" } }));
  };

  const handleRemoveItem = (key, index, tipoExtra = null) => {
    if (tipoExtra) {
      const novaLista = (produtoForm.extras[tipoExtra] || []).filter((_, i) => i !== index);
      setProdutoForm((prev) => ({ ...prev, extras: { ...prev.extras, [tipoExtra]: novaLista } }));
      return;
    }
    setProdutoForm((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const handleDuplicarProduto = async (id) => {
    try {
      const res = await axios.post(`${API_URL}/api/produtos/duplicar/${id}`);
      const novoId = res.data?._id;
      setProdutoDestaqueId(novoId);
      await fetchProdutos();

      setTimeout(() => {
        const ref = produtoRefs.current[novoId];
        if (ref) ref.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);

      setTimeout(() => setProdutoDestaqueId(null), 3500);
      handleSnackbar("Produto duplicado!");
    } catch (err) {
      console.error(err);
      handleSnackbar("Erro ao duplicar produto", "error");
    }
  };

  const moverProduto = (categoriaId, produtoId, direcao) => {
    const novaLista = [...produtos];
    const produtosDaCategoria = novaLista
      .filter((p) => (p.categoria?._id || p.categoria) === categoriaId)
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

    const index = produtosDaCategoria.findIndex((p) => p._id === produtoId);
    const destino = index + direcao;
    if (index < 0 || destino < 0 || destino >= produtosDaCategoria.length) return;

    [produtosDaCategoria[index], produtosDaCategoria[destino]] = [produtosDaCategoria[destino], produtosDaCategoria[index]];
    produtosDaCategoria.forEach((p, i) => (p.ordem = i));

    const novaOrdemFinal = novaLista.map((p) => produtosDaCategoria.find((px) => px._id === p._id) || p);
    setProdutos(novaOrdemFinal);

    const payload = produtosDaCategoria.map((p) => ({ _id: p._id, ordem: p.ordem }));
    handleSnackbar("Reordenando…", "info");
    axios
      .put(`${API_URL}/api/produtos/ordem/reordenar`, { produtos: payload })
      .then(() => handleSnackbar("Ordem atualizada!"))
      .catch(() => handleSnackbar("Erro ao atualizar ordem", "error"));
  };

  const toggleProdutoAtivo = async (produtoId, estadoAtual) => {
    try {
      await axios.put(`${API_URL}/api/produtos/${produtoId}/${estadoAtual ? "desativar" : "ativar"}`);
      await fetchProdutos();
      handleSnackbar(`Produto ${estadoAtual ? "desativado" : "ativado"}!`);
    } catch (err) {
      console.error(err);
      handleSnackbar("Erro ao alterar status", "error");
    }
  };

  const handleDeleteProduto = async (id) => {
    if (!window.confirm("Tem certeza que deseja excluir este produto?")) return;
    try {
      await axios.delete(`${API_URL}/api/produtos/${id}`);
      await fetchProdutos();
      handleSnackbar("Produto excluído!");
    } catch (err) {
      console.error(err);
      handleSnackbar("Erro ao excluir produto", "error");
    }
  };

  const categoriaSelecionada = categorias.find((c) => c._id === produtoForm.categoria);

  const renderGrupo = (label, key) => (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        borderRadius: 2,
        borderColor: "rgba(148,163,184,0.35)",
        background: "#fff",
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography fontWeight={800} sx={{ fontSize: 13 }}>
          {label}
        </Typography>
        <Chip size="small" label={`${produtoForm[key]?.length || 0} itens`} sx={{ height: 20 }} />
      </Stack>

      <Grid container spacing={1}>
        <Grid item xs={12} sm={6}>
          <TextField
            label="Nome"
            size="small"
            fullWidth
            value={tempInputs[key].nome}
            onChange={(e) => setTempInputs((prev) => ({ ...prev, [key]: { ...prev[key], nome: e.target.value } }))}
          />
        </Grid>
        <Grid item xs={12} sm={3}>
          <TextField
            label="Preço"
            size="small"
            fullWidth
            type="number"
            inputProps={{ step: "0.01", min: "0" }}
            value={tempInputs[key].preco}
            onChange={(e) => setTempInputs((prev) => ({ ...prev, [key]: { ...prev[key], preco: e.target.value } }))}
          />
        </Grid>
        <Grid item xs={12} sm={3}>
          <Button variant="outlined" size="small" fullWidth onClick={() => handleAddItem(key)}>
            Adicionar
          </Button>
        </Grid>

        <Grid item xs={12}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {(produtoForm[key] || []).map((item, index) => (
              <Chip
                key={index}
                label={`${item.nome} - R$ ${Number(item.preco || 0).toFixed(2)}`}
                onDelete={() => handleRemoveItem(key, index)}
                sx={{ maxWidth: "100%" }}
              />
            ))}
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );

  const renderExtras = () => {
    if (!categoriaSelecionada?.tiposExtras?.length) return null;

    const getDescricaoTipoExtra = (extra) => {
      if (extra.tipoSelecion === "multiplo") {
        return `Múltiplas escolhas ${extra.obrigatorio ? `(mín. ${extra.minimoSelecionados}, ` : "("}máx. ${extra.maximoSelecionados})`;
      }
      return extra.obrigatorio ? "Escolha única (obrigatório)" : "Escolha única";
    };

    return (
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 2,
          borderColor: "rgba(148,163,184,0.35)",
          background: "#fff",
        }}
      >
        <Typography fontWeight={800} sx={{ fontSize: 13, mb: 1 }}>
          Extras por tipo
        </Typography>

        <Stack spacing={2}>
          {categoriaSelecionada.tiposExtras.map((extra, idx) => (
            <Box key={idx}>
              <Typography fontWeight={700} sx={{ fontSize: 12, mb: 0.5 }}>
                {extra.nome} — <span style={{ opacity: 0.75 }}>{getDescricaoTipoExtra(extra)}</span>
              </Typography>

              <Grid container spacing={1}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Nome"
                    size="small"
                    fullWidth
                    value={tempInputs.extras?.[extra.nome]?.nome || ""}
                    onChange={(e) =>
                      setTempInputs((prev) => ({
                        ...prev,
                        extras: {
                          ...prev.extras,
                          [extra.nome]: { ...(prev.extras?.[extra.nome] || {}), nome: e.target.value },
                        },
                      }))
                    }
                  />
                </Grid>

                <Grid item xs={12} sm={3}>
                  <TextField
                    label="Preço"
                    size="small"
                    fullWidth
                    type="number"
                    inputProps={{ step: "0.01", min: "0" }}
                    value={tempInputs.extras?.[extra.nome]?.preco || ""}
                    onChange={(e) =>
                      setTempInputs((prev) => ({
                        ...prev,
                        extras: {
                          ...prev.extras,
                          [extra.nome]: { ...(prev.extras?.[extra.nome] || {}), preco: e.target.value },
                        },
                      }))
                    }
                  />
                </Grid>

                <Grid item xs={12} sm={3}>
                  <Button variant="outlined" size="small" fullWidth onClick={() => handleAddItem(null, extra.nome)}>
                    Adicionar
                  </Button>
                </Grid>

                <Grid item xs={12}>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {(produtoForm.extras?.[extra.nome] || []).map((item, index) => (
                      <Chip
                        key={index}
                        label={`${item.nome} - R$ ${Number(item.preco || 0).toFixed(2)}`}
                        onDelete={() => handleRemoveItem(null, index, extra.nome)}
                      />
                    ))}
                  </Box>
                </Grid>
              </Grid>
            </Box>
          ))}
        </Stack>
      </Paper>
    );
  };

  // filtros aplicados
  const produtosFiltrados = produtos.filter((p) => {
    const texto = filtroTexto.trim().toLowerCase();
    const matchTexto =
      texto === "" ||
      (p.nome || "").toLowerCase().includes(texto) ||
      (p.descricao || "").toLowerCase().includes(texto);

    const matchCategoria =
      filtroCategoria === "todas" || (p.categoria?._id || p.categoria) === filtroCategoria;

    const matchStatus = mostrarSomenteInativos ? p.ativo === false : true;

    return matchTexto && matchCategoria && matchStatus;
  });

  const nenhumaCategoriaComProdutos = categorias.every((cat) => {
    const produtosCat = produtosFiltrados.filter((p) => (p.categoria?._id || p.categoria) === cat._id);
    return produtosCat.length === 0;
  });

  return (
    // ✅ Container com rolagem interna (resolve “não consigo rolar”)
    <Box
      sx={{
        height: "calc(100vh - 260px)", // ajuste fino se quiser (depende do seu layout acima)
        overflowY: "auto",
        pr: 1,
        "&::-webkit-scrollbar": { width: 10 },
        "&::-webkit-scrollbar-thumb": { background: "rgba(148,163,184,0.55)", borderRadius: 999 },
        "&::-webkit-scrollbar-track": { background: "transparent" },
      }}
    >
      <Paper
        sx={{
          p: 2.5,
          borderRadius: 3,
          background: "linear-gradient(180deg, rgba(248,250,252,0.95), #ffffff)",
        }}
      >
        {/* HEADER (sticky) */}
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            background: "linear-gradient(180deg, rgba(248,250,252,0.98), rgba(255,255,255,0.98))",
            backdropFilter: "blur(8px)",
            borderBottom: "1px solid rgba(148,163,184,0.25)",
            pb: 1.5,
            mb: 2,
          }}
        >
          <Stack direction={{ xs: "column", md: "row" }} alignItems={{ xs: "flex-start", md: "center" }} justifyContent="space-between" spacing={1}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: 0.2 }}>
                {produtoEditandoId ? "Editar produto" : "Cadastrar novo produto"}
              </Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Preço, imagem, personalizações e extras por categoria.
              </Typography>
            </Box>

            {/* AÇÕES FIXAS */}
            <Stack direction="row" spacing={1} alignItems="center">
              {produtoEditandoId && (
                <Chip size="small" color="primary" label="Editando" sx={{ borderRadius: 999 }} />
              )}

              <Button
                variant="contained"
                onClick={handleCreateProduto}
                disabled={!produtoForm.categoria}
                sx={{
                  textTransform: "none",
                  fontWeight: 800,
                  borderRadius: 999,
                  px: 2.5,
                  backgroundImage: produtoEditandoId
                    ? "linear-gradient(135deg, #2563eb, #1d4ed8)"
                    : "linear-gradient(135deg, #ff3b8a, #ff9b2d)",
                }}
              >
                {produtoEditandoId ? "Salvar" : "Cadastrar"}
              </Button>

              <Button
                variant="text"
                color="inherit"
                onClick={limparFormulario}
                sx={{ textTransform: "none" }}
              >
                Limpar
              </Button>
            </Stack>
          </Stack>
        </Box>

        {/* FORM - bloco organizado */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: "rgba(148,163,184,0.35)" }}>
              <Typography fontWeight={900} sx={{ fontSize: 13, mb: 1 }}>
                Básico
              </Typography>

              <FormControl fullWidth error={categoriaErro} size="small" sx={{ mb: 1.5 }}>
                <InputLabel id="categoria-label">Categoria</InputLabel>
                <Select
                  labelId="categoria-label"
                  label="Categoria"
                  value={produtoForm.categoria}
                  onChange={(e) => {
                    setProdutoForm((prev) => ({ ...prev, categoria: e.target.value }));
                    setCategoriaErro(false);
                  }}
                  startAdornment={
                    <InputAdornment position="start">
                      <CategoryIcon fontSize="small" />
                    </InputAdornment>
                  }
                >
                  <MenuItem value="none">Selecione</MenuItem>
                  {categorias.map((cat) => (
                    <MenuItem key={cat._id} value={cat._id}>
                      {cat.nome}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Nome do produto"
                size="small"
                fullWidth
                value={produtoForm.nome}
                onChange={(e) => setProdutoForm((prev) => ({ ...prev, nome: e.target.value }))}
                disabled={!produtoForm.categoria}
                sx={{ mb: 1.5 }}
              />

              <TextField
                label="Descrição"
                size="small"
                fullWidth
                value={produtoForm.descricao}
                onChange={(e) => setProdutoForm((prev) => ({ ...prev, descricao: e.target.value }))}
                disabled={!produtoForm.categoria}
                sx={{ mb: 1.5 }}
              />

              <TextField
                label="Preço base"
                size="small"
                fullWidth
                value={formatCurrency(produtoForm.precoBase)}
                onChange={(e) =>
                  setProdutoForm((prev) => ({
                    ...prev,
                    precoBase: e.target.value.replace(/[^\d]/g, ""),
                  }))
                }
                inputProps={{ inputMode: "numeric" }}
                disabled={!produtoForm.categoria}
              />
            </Paper>
          </Grid>

          <Grid item xs={12} md={8}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: "rgba(148,163,184,0.35)" }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography fontWeight={900} sx={{ fontSize: 13 }}>
                  Imagem
                </Typography>
                {(produtoForm.imagemPreview || produtoForm.imagemUrl) && (
                  <Button
                    size="small"
                    color="error"
                    startIcon={<CloseIcon />}
                    onClick={removerImagemSelecionada}
                    sx={{ textTransform: "none" }}
                  >
                    Remover
                  </Button>
                )}
              </Stack>

              <Grid container spacing={1.5} alignItems="center">
                <Grid item xs={12} sm={6}>
                  <label htmlFor="produto-imagem">
                    <HiddenInput accept="image/*" id="produto-imagem" type="file" onChange={handleFileChange} />
                    <Button
                      variant="outlined"
                      component="span"
                      startIcon={<ImageIcon />}
                      disabled={!produtoForm.categoria}
                      fullWidth
                      sx={{ textTransform: "none", borderRadius: 2 }}
                    >
                      Upload imagem
                    </Button>
                  </label>
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Imagem (URL opcional)"
                    size="small"
                    fullWidth
                    value={produtoForm.imagemUrl}
                    onChange={(e) => setProdutoForm((prev) => ({ ...prev, imagemUrl: e.target.value }))}
                    disabled={!produtoForm.categoria || !!produtoForm.imagem}
                    helperText={produtoForm.imagem ? "Remova o arquivo para usar URL" : "Se não enviar arquivo, pode usar URL"}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Box
                    sx={{
                      mt: 1,
                      display: "flex",
                      gap: 2,
                      alignItems: "center",
                      p: 1.5,
                      borderRadius: 2,
                      border: "1px solid rgba(148,163,184,0.35)",
                      background: "linear-gradient(180deg, rgba(248,250,252,0.8), #fff)",
                    }}
                  >
                    <Box
                      component="img"
                      src={produtoForm.imagemPreview || produtoForm.imagemUrl || MOCK_IMAGE}
                      sx={{
                        width: 180,
                        height: 110,
                        objectFit: "cover",
                        borderRadius: 2,
                        border: "1px solid rgba(148,163,184,0.35)",
                      }}
                    />

                    <Box sx={{ flex: 1 }}>
                      <Typography fontWeight={900} sx={{ fontSize: 13 }}>
                        Preview
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary" }}>
                        {produtoForm.imagem
                          ? `Arquivo: ${produtoForm.imagem.name}`
                          : produtoForm.imagemUrl
                          ? "Usando URL informada"
                          : "Usando imagem padrão"}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5 }}>
                        Dica: imagem bonita aumenta conversão no cardápio.
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          {/* PERSONALIZAÇÕES */}
          {produtoForm.categoria && (
            <Grid item xs={12}>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, borderColor: "rgba(148,163,184,0.35)" }}>
                <Typography fontWeight={900} sx={{ fontSize: 13, mb: 1 }}>
                  Personalizações
                </Typography>

                <Stack spacing={2}>
                  {categoriaSelecionada?.permiteSabores && renderGrupo("Sabores", "sabores")}
                  {categoriaSelecionada?.permiteBordas && renderGrupo("Bordas", "bordas")}
                  {categoriaSelecionada?.permiteAdicionais && renderGrupo("Adicionais", "adicionais")}
                  {categoriaSelecionada?.permiteComplementos && renderGrupo("Complementos", "complementos")}
                  {renderExtras()}
                </Stack>
              </Paper>
            </Grid>
          )}
        </Grid>

        <Divider sx={{ my: 2.5 }} />

        {/* FILTROS (colapsável) */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Produtos cadastrados
          </Typography>

          <Button
            size="small"
            startIcon={<TuneIcon />}
            onClick={() => setMostrarFiltros((v) => !v)}
            sx={{ textTransform: "none" }}
          >
            {mostrarFiltros ? "Ocultar filtros" : "Mostrar filtros"}
          </Button>
        </Stack>

        <Collapse in={mostrarFiltros}>
          <Box
            sx={{
              mb: 2.5,
              p: 1.5,
              borderRadius: 2,
              border: "1px solid rgba(148,163,184,0.35)",
              backgroundColor: "#f9fafb",
            }}
          >
            <Grid container spacing={1.5} alignItems="center">
              <Grid item xs={12} md={5}>
                <TextField
                  size="small"
                  fullWidth
                  label="Buscar por nome ou descrição"
                  value={filtroTexto}
                  onChange={(e) => setFiltroTexto(e.target.value)}
                />
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filtro-cat-label">Categoria</InputLabel>
                  <Select
                    labelId="filtro-cat-label"
                    label="Categoria"
                    value={filtroCategoria}
                    onChange={(e) => setFiltroCategoria(e.target.value)}
                  >
                    <MenuItem value="todas">Todas</MenuItem>
                    {categorias.map((cat) => (
                      <MenuItem key={cat._id} value={cat._id}>
                        {cat.nome}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={4}>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={mostrarSomenteInativos}
                      onChange={(e) => setMostrarSomenteInativos(e.target.checked)}
                    />
                  }
                  label="Somente inativos"
                />
              </Grid>
            </Grid>
          </Box>
        </Collapse>

        {/* LISTA */}
        {nenhumaCategoriaComProdutos ? (
          <Box
            sx={{
              p: 3,
              borderRadius: 3,
              border: "1px dashed rgba(148,163,184,0.6)",
              textAlign: "center",
              color: "text.secondary",
              backgroundColor: "#f9fafb",
            }}
          >
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Nenhum produto encontrado com os filtros atuais.
            </Typography>
            <Typography variant="caption">
              Ajuste os filtros ou cadastre um novo produto acima.
            </Typography>
          </Box>
        ) : (
          categorias.map((cat) => {
            const produtosCat = produtosFiltrados
              .filter((p) => (p.categoria?._id || p.categoria) === cat._id)
              .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

            if (!produtosCat.length) return null;

            return (
              <Accordion key={cat._id} sx={{ mb: 1.5 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography fontWeight={800}>{cat.nome}</Typography>
                    <Chip size="small" label={`${produtosCat.length}`} sx={{ height: 20 }} />
                  </Stack>
                </AccordionSummary>

                <AccordionDetails>
                  <Stack spacing={2}>
                    {produtosCat.map((prod) => (
                      <Paper
                        key={prod._id}
                        ref={(el) => (produtoRefs.current[prod._id] = el)}
                        sx={{
                          p: 2,
                          display: "flex",
                          gap: 2,
                          alignItems: "flex-start",
                          borderRadius: 2.5,
                          border: "1px solid rgba(148,163,184,0.35)",
                          background:
                            prod._id === produtoDestaqueId
                              ? "linear-gradient(180deg, #fff9c4, #ffffff)"
                              : "#fff",
                          transition: "background-color 0.5s ease",
                        }}
                      >
                        {/* esquerda */}
                        <Box sx={{ width: 190, flexShrink: 0 }}>
                          <Box
                            component="img"
                            src={prod.imagem || MOCK_IMAGE}
                            sx={{
                              width: "100%",
                              height: 120,
                              objectFit: "cover",
                              borderRadius: 2,
                              border: "1px solid rgba(148,163,184,0.35)",
                              mb: 1,
                            }}
                          />
                          <Typography fontWeight={900} sx={{ fontSize: 14 }}>
                            {prod.nome}
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>
                            R$ {Number(prod.precoBase || 0).toFixed(2)}
                          </Typography>

                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.8 }}>
                            <Chip
                              size="small"
                              label={prod.ativo === false ? "Inativo" : "Ativo"}
                              sx={{
                                height: 20,
                                fontSize: "0.7rem",
                                borderRadius: 999,
                                backgroundColor: prod.ativo === false ? "#4b5563" : "#16a34a",
                                color: "#fff",
                              }}
                            />
                          </Stack>
                        </Box>

                        {/* direita */}
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ mb: 1, color: "text.secondary" }}>
                            {prod.descricao || <span style={{ opacity: 0.6 }}>Sem descrição</span>}
                          </Typography>

                          {/* ações */}
                          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
                            <Tooltip title="Subir">
                              <IconButton size="small" onClick={() => moverProduto(cat._id, prod._id, -1)}>
                                <ArrowUpwardIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>

                            <Tooltip title="Descer">
                              <IconButton size="small" onClick={() => moverProduto(cat._id, prod._id, 1)}>
                                <ArrowDownwardIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>

                            <Tooltip title="Duplicar">
                              <IconButton size="small" color="secondary" onClick={() => handleDuplicarProduto(prod._id)}>
                                <ContentCopyIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>

                            <Tooltip title="Editar">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => {
                                  setProdutoEditandoId(prod._id);

                                  setProdutoForm({
                                    nome: prod.nome || "",
                                    descricao: prod.descricao || "",
                                    precoBase: String(Math.round(Number(prod.precoBase || 0) * 100)),
                                    imagem: null,
                                    imagemPreview: "",
                                    imagemUrl:
                                      prod.imagem && prod.imagem !== MOCK_IMAGE ? prod.imagem : "",
                                    categoria: prod.categoria?._id || prod.categoria,
                                    sabores: prod.sabores || [],
                                    bordas: prod.bordas || [],
                                    adicionais: prod.adicionais || [],
                                    complementos: prod.complementos || [],
                                    extras: prod.extras || {},
                                  });

                                  setTimeout(() => {
                                    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }, 100);
                                }}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>

                            <Tooltip title="Excluir">
                              <IconButton size="small" color="error" onClick={() => handleDeleteProduto(prod._id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>

                            <FormControlLabel
                              control={
                                <Switch
                                  size="small"
                                  checked={prod.ativo !== false}
                                  onChange={() => toggleProdutoAtivo(prod._id, prod.ativo)}
                                />
                              }
                              label={prod.ativo === false ? "Inativo" : "Ativo"}
                              sx={{ ml: 1 }}
                            />
                          </Stack>

                          {/* tags rápidas */}
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
                            {prod.sabores?.length > 0 && <Chip size="small" label="Sabores" sx={{ height: 20, fontSize: "0.7rem" }} />}
                            {prod.bordas?.length > 0 && <Chip size="small" label="Bordas" sx={{ height: 20, fontSize: "0.7rem" }} />}
                            {prod.adicionais?.length > 0 && <Chip size="small" label="Adicionais" sx={{ height: 20, fontSize: "0.7rem" }} />}
                            {prod.complementos?.length > 0 && <Chip size="small" label="Complementos" sx={{ height: 20, fontSize: "0.7rem" }} />}
                            {prod.extras && Object.keys(prod.extras).length > 0 && (
                              <Chip size="small" label="Extras" sx={{ height: 20, fontSize: "0.7rem" }} />
                            )}
                          </Box>

                          {/* detalhes */}
                          <Accordion
                            sx={{
                              background: "linear-gradient(135deg, #1f2937, #111827)",
                              color: "white",
                              borderRadius: 2,
                              border: "1px solid rgba(255,255,255,0.08)",
                              overflow: "hidden",
                              "&:before": { display: "none" },
                            }}
                          >
                            <AccordionSummary
                              expandIcon={<ExpandMoreIcon sx={{ color: "white" }} />}
                              sx={{ "& .MuiAccordionSummary-content": { margin: "10px 0" } }}
                            >
                              <Typography variant="subtitle2" fontWeight={800} sx={{ color: "#fff" }}>
                                Itens personalizáveis
                              </Typography>
                            </AccordionSummary>

                            <AccordionDetails sx={{ background: "rgba(255,255,255,0.04)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                              {["sabores", "bordas", "adicionais", "complementos"].map(
                                (key) =>
                                  prod[key] &&
                                  prod[key].length > 0 && (
                                    <Box key={key} mt={1}>
                                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>
                                        {key.charAt(0).toUpperCase() + key.slice(1)}:
                                      </Typography>
                                      <Box display="flex" gap={1} flexWrap="wrap">
                                        {prod[key].map((item, idx) => (
                                          <Chip
                                            key={idx}
                                            label={`${item.nome} - R$ ${Number(item.preco || 0).toFixed(2)}`}
                                            sx={{ backgroundColor: "rgba(255,255,255,0.12)", color: "white" }}
                                          />
                                        ))}
                                      </Box>
                                    </Box>
                                  )
                              )}

                              {prod.extras &&
                                typeof prod.extras === "object" &&
                                Object.entries(prod.extras).map(([extraNome, itens]) =>
                                  Array.isArray(itens) && itens.length > 0 ? (
                                    <Box key={extraNome} mt={2}>
                                      <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 0.5 }}>
                                        {extraNome}:
                                      </Typography>
                                      <Box display="flex" gap={1} flexWrap="wrap">
                                        {itens.map((item, idx) => (
                                          <Chip
                                            key={idx}
                                            label={`${item.nome} - R$ ${Number(item.preco || 0).toFixed(2)}`}
                                            sx={{ backgroundColor: "rgba(255,255,255,0.12)", color: "white" }}
                                          />
                                        ))}
                                      </Box>
                                    </Box>
                                  ) : null
                                )}
                            </AccordionDetails>
                          </Accordion>
                        </Box>
                      </Paper>
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })
        )}
      </Paper>
    </Box>
  );
}
