const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
require('dotenv').config();

const mapboxToken =  process.env.MAPBOX_ACCESS_TOKEN;

const calcularDistanciaMapbox = async (latitude, longitude) => {
  const lojaLatitude = -8.01548359750091;
  const lojaLongitude = -34.85672369599343;

  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lojaLongitude},${lojaLatitude};${longitude},${latitude}?access_token=${mapboxToken}&geometries=geojson`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      return data.routes[0].distance; // em metros
    } else {
      throw new Error("Resposta inesperada do Mapbox");
    }
  } catch (error) {
    console.error("❌ Erro ao calcular distância com Mapbox:", error.message);
    return null;
  }
};

module.exports = { calcularDistanciaMapbox };
