const CALLBACK_NAME = "__movyoGoogleMapsReady";

export const GOOGLE_MAPS_API_KEY = String(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    import.meta.env.VITE_GOOGLE_MAPS_KEY ||
    import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY ||
    import.meta.env.REACT_APP_GOOGLE_MAPS_KEY ||
    ""
).trim();

const uniqueLibraries = (libraries = []) =>
  [...new Set((libraries || []).map((lib) => String(lib || "").trim()).filter(Boolean))];

export function hasGoogleMapsKey() {
  return GOOGLE_MAPS_API_KEY.length > 0;
}

export function loadGoogleMaps(libraries = ["places", "geometry", "drawing"]) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps só pode ser carregado no navegador."));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error("Configure VITE_GOOGLE_MAPS_API_KEY no ambiente do Desktop."));
  }

  if (window.__movyoGoogleMapsPromise) {
    return window.__movyoGoogleMapsPromise;
  }

  const libs = uniqueLibraries(libraries);
  window.__movyoGoogleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-movyo-google-maps="true"]');

    window[CALLBACK_NAME] = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps carregou, mas o objeto google.maps não ficou disponível."));
    };

    if (existing) {
      existing.addEventListener("error", () => reject(new Error("Erro ao carregar Google Maps.")), { once: true });
      return;
    }

    const params = new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      callback: CALLBACK_NAME,
      language: "pt-BR",
      region: "BR",
      v: "weekly",
    });

    if (libs.length) params.set("libraries", libs.join(","));

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.dataset.movyoGoogleMaps = "true";
    script.onerror = () => reject(new Error("Erro ao carregar Google Maps."));
    document.head.appendChild(script);
  });

  return window.__movyoGoogleMapsPromise;
}

export function makeLatLng(coord) {
  if (!coord) return null;
  const lat = Number(coord.latitude ?? coord.lat);
  const lng = Number(coord.longitude ?? coord.lng ?? coord.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function pathFromStoredCoordinates(coordenadas = []) {
  const ring = Array.isArray(coordenadas?.[0]?.[0]) ? coordenadas[0] : coordenadas;
  if (!Array.isArray(ring)) return [];
  return ring
    .map((point) => {
      if (Array.isArray(point)) return { lat: Number(point[1]), lng: Number(point[0]) };
      return makeLatLng(point);
    })
    .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

export function storedCoordinatesFromPath(path = []) {
  const points = Array.from({ length: path.getLength?.() || 0 }, (_, i) => path.getAt(i));
  const ring = points.map((point) => [Number(point.lng()), Number(point.lat())]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([...ring[0]]);
  }
  return [ring];
}
