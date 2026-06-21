const GOOGLE_MAPS_API_KEY = String(
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
    import.meta.env.VITE_GOOGLE_MAPS_KEY ||
    ""
).trim();

export const buscarEndereco = async (enderecoParcial) => {
  const termo = String(enderecoParcial || "").trim();
  if (!termo || !GOOGLE_MAPS_API_KEY) return [];

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({
        address: termo,
        components: "country:BR",
        language: "pt-BR",
        region: "br",
        key: GOOGLE_MAPS_API_KEY,
      }).toString()}`
    );

    if (!response.ok) throw new Error("Erro ao buscar endereço no Google Maps");

    const data = await response.json();
    if (data.status !== "OK") return [];

    return (data.results || []).slice(0, 5).map((result) => {
      const components = result.address_components || [];
      const find = (type) => components.find((c) => c.types?.includes(type))?.long_name || "";
      const loc = result.geometry?.location || {};
      return {
        label: result.formatted_address,
        cep: find("postal_code"),
        bairro: find("sublocality") || find("sublocality_level_1") || find("neighborhood"),
        latitude: loc.lat,
        longitude: loc.lng,
      };
    });
  } catch (error) {
    console.error("Erro na busca do endereço:", error);
    return [];
  }
};
