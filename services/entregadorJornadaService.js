const Entregador = require("../models/Entregador");
const EntregadorOnline = require("../models/EntregadorOnline");
const { formatOperationalDateISO } = require("../utils/operationalDateTime");

function idString(value) {
  return String(value?._id || value?.id || value || "");
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function haversineKm(a, b) {
  const lat1 = toNumber(a?.latitude);
  const lon1 = toNumber(a?.longitude);
  const lat2 = toNumber(b?.latitude);
  const lon2 = toNumber(b?.longitude);
  if ([lat1, lon1, lat2, lon2].some((value) => value === null)) return 0;

  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function obterJornadaHoje(entregador, createIfMissing = false) {
  const entregadorId = idString(entregador);
  const restauranteId = idString(entregador?.restaurante || entregador?.restauranteId);
  const dia = formatOperationalDateISO();
  let jornada = await EntregadorOnline.findOne({ entregadorId, dia });

  if (!jornada && createIfMissing) {
    jornada = await EntregadorOnline.create({
      entregadorId,
      restauranteId,
      dia,
      online: false,
      dataEntrada: new Date(),
      segundosOnlineAcumulados: 0,
      distanciaPercorridaKm: 0,
      valorRecebido: 0,
    });
  }
  return jornada;
}

async function atualizarStatusJornada(entregador, online) {
  const agora = new Date();
  const jornada = await obterJornadaHoje(entregador, true);
  const estavaOnline = jornada.online === true;

  if (online && !estavaOnline) {
    jornada.online = true;
    jornada.onlineDesde = agora;
    jornada.dataSaida = null;
    if (!jornada.dataEntrada) jornada.dataEntrada = agora;
  }

  if (!online) {
    if (estavaOnline) {
      const inicio = jornada.onlineDesde ? new Date(jornada.onlineDesde) : agora;
      const segundos = Math.max(0, Math.round((agora.getTime() - inicio.getTime()) / 1000));
      jornada.segundosOnlineAcumulados =
        Math.max(0, Number(jornada.segundosOnlineAcumulados || 0)) + segundos;
    }
    jornada.online = false;
    jornada.dataSaida = agora;
    jornada.ultimoOfflineEm = agora;
    jornada.onlineDesde = null;
  }

  await jornada.save();
  await Entregador.findByIdAndUpdate(idString(entregador), {
    status: online,
    disponivel: online,
    ...(online ? { ultimoOnlineEm: agora } : { ultimoOfflineEm: agora }),
  });
  return jornada;
}

async function registrarLocalizacao(entregador, localizacao) {
  const agora = new Date();
  const jornada = await obterJornadaHoje(entregador, true);
  const anterior = jornada.localizacao || entregador?.localizacao || null;
  const distanciaKm = haversineKm(anterior, localizacao);
  const ultimaEm = jornada.ultimaLocalizacaoEm
    ? new Date(jornada.ultimaLocalizacaoEm)
    : null;
  const horas = ultimaEm ? Math.max(1 / 3600, (agora - ultimaEm) / 3600000) : null;
  const velocidadeKmh = horas ? distanciaKm / horas : 0;

  if (
    jornada.online === true &&
    distanciaKm >= 0.005 &&
    distanciaKm <= 5 &&
    (!horas || velocidadeKmh <= 180)
  ) {
    jornada.distanciaPercorridaKm =
      Math.max(0, Number(jornada.distanciaPercorridaKm || 0)) + distanciaKm;
  }

  jornada.localizacao = localizacao;
  jornada.ultimaLocalizacaoEm = agora;
  await jornada.save();

  await Entregador.findByIdAndUpdate(idString(entregador), {
    localizacao,
    ultimaLocalizacaoEm: agora,
  });

  return { jornada, distanciaAdicionadaKm: distanciaKm };
}

function segundosOnline(jornada, agora = new Date()) {
  let total = Math.max(0, Number(jornada?.segundosOnlineAcumulados || 0));
  if (jornada?.online && jornada?.onlineDesde) {
    total += Math.max(0, Math.round((agora - new Date(jornada.onlineDesde)) / 1000));
  }
  return total;
}

module.exports = {
  atualizarStatusJornada,
  registrarLocalizacao,
  obterJornadaHoje,
  segundosOnline,
  haversineKm,
};
