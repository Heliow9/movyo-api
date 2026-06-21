const { geocodificarEndereco } = require('../services/distanciaService');

const CEP_CACHE_TTL_MS = Number(process.env.CEP_CACHE_TTL_MS || 12 * 60 * 60 * 1000);
const cepCache = new Map();

function limparCep(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

function soTexto(value = '') {
  return String(value || '').trim();
}

function normalizarCepPayload(payload = {}, fonte = 'desconhecida') {
  const cep = limparCep(payload.cep || payload.postalCode || payload.postal_code || '');
  const rua = soTexto(payload.logradouro || payload.street || payload.address || payload.addressName || '');
  const bairro = soTexto(payload.bairro || payload.neighborhood || payload.district || '');
  const cidade = soTexto(payload.localidade || payload.cidade || payload.city || '');
  const estado = soTexto(payload.uf || payload.estado || payload.state || '');

  if (!cep && !rua && !bairro && !cidade && !estado) return null;

  return {
    cep,
    logradouro: rua,
    rua,
    bairro,
    localidade: cidade,
    cidade,
    uf: estado,
    estado,
    fonte,
  };
}

async function fetchJsonComTimeout(url, timeoutMs = 7000) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      signal: controller?.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Movyo-API/1.0',
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function buscarViaCep(cep) {
  const data = await fetchJsonComTimeout(`https://viacep.com.br/ws/${cep}/json/`, 7000);
  if (!data || data.erro) return null;
  return normalizarCepPayload(data, 'viacep');
}

async function buscarBrasilApi(cep) {
  const data = await fetchJsonComTimeout(`https://brasilapi.com.br/api/cep/v1/${cep}`, 7000);
  return normalizarCepPayload(data, 'brasilapi');
}

async function buscarGoogleGeocodePorCep(cep) {
  const coords = await geocodificarEndereco(`${cep}, Brasil`);
  if (!coords) return null;

  const key = String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || '').trim();
  if (!key) {
    return {
      cep,
      logradouro: '',
      rua: '',
      bairro: '',
      localidade: '',
      cidade: '',
      uf: '',
      estado: '',
      latitude: coords.latitude,
      longitude: coords.longitude,
      fonte: 'google-geocode',
    };
  }

  try {
    const params = new URLSearchParams({
      address: `${cep}, Brasil`,
      components: 'country:BR',
      language: 'pt-BR',
      region: 'br',
      key,
    });
    const data = await fetchJsonComTimeout(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, 7000);
    const result = Array.isArray(data?.results) ? data.results[0] : null;
    if (!result) return null;

    const comps = result.address_components || [];
    const findShort = (type) => comps.find((c) => c.types?.includes(type))?.short_name || '';
    const findLong = (type) => comps.find((c) => c.types?.includes(type))?.long_name || '';
    const endereco = normalizarCepPayload({
      cep,
      logradouro: findLong('route'),
      bairro: findLong('sublocality') || findLong('sublocality_level_1') || findLong('neighborhood'),
      localidade: findLong('administrative_area_level_2'),
      uf: findShort('administrative_area_level_1'),
    }, 'google-geocode');
    return {
      ...(endereco || {}),
      latitude: coords.latitude,
      longitude: coords.longitude,
      formattedAddress: result.formatted_address,
      fonte: 'google-geocode',
    };
  } catch {
    return {
      cep,
      logradouro: '',
      rua: '',
      bairro: '',
      localidade: '',
      cidade: '',
      uf: '',
      estado: '',
      latitude: coords.latitude,
      longitude: coords.longitude,
      fonte: 'google-geocode',
    };
  }
}

async function buscarCep(req, res) {
  const cep = limparCep(req.params.cep || req.query.cep);
  if (cep.length !== 8) {
    return res.status(400).json({ ok: false, erro: 'CEP inválido. Informe 8 números.' });
  }

  const cacheKey = cep;
  const cached = cepCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CEP_CACHE_TTL_MS) {
    return res.json({ ok: true, endereco: cached.data, cache: true });
  }

  const tentativas = [];
  for (const fn of [buscarViaCep, buscarBrasilApi, buscarGoogleGeocodePorCep]) {
    try {
      const endereco = await fn(cep);
      if (endereco) {
        cepCache.set(cacheKey, { at: Date.now(), data: endereco });
        return res.json({ ok: true, endereco, cache: false });
      }
      tentativas.push('sem_resultado');
    } catch (error) {
      tentativas.push(error?.message || String(error));
    }
  }

  return res.status(404).json({
    ok: false,
    erro: 'CEP não encontrado nos provedores disponíveis.',
    cep,
    tentativas,
  });
}

module.exports = { buscarCep };
