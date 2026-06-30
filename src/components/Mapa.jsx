import React, { useEffect, useState, useRef } from "react";
import Map, { Marker, Popup } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import io from "socket.io-client";
import axios from "axios";
import { useMapContext } from "../Context/MapContext";
import capaceteIcon from "../assets/helmet.png";
import restaurantePin from "../assets/restaurantPin.png";

const apiUrl = "https://api.movyo.delivery/api";
const SOCKET_URL = "https://api.movyo.delivery";
import.meta.env.VITE_MAPBOX_TOKEN
const Mapa = ({ fullscreen = false }) => {
  const [motoristas, setMotoristas] = useState([]);
  const [restauranteId, setRestauranteId] = useState(null);
  const [restauranteData, setRestauranteData] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const mapRef = useRef(null);
  const { selectedPosition, pedidosMap } = useMapContext();
  const [popupPedidoSelecionado, setPopupPedidoSelecionado] = useState(null);

  // Busca restaurante logado
  useEffect(() => {
    const fetchRestaurante = async () => {
      const token = localStorage.getItem("token");

      try {
        const response = await fetch(`${apiUrl}/restaurantes/me`, {
          method: "GET",
          headers: { Authorization: token },
        });

        if (!response.ok) throw new Error("Erro ao buscar restaurante");

        const data = await response.json();
        setRestauranteId(data._id);
        setRestauranteData(data);
      } catch (error) {
        console.error("Erro ao obter restaurante:", error);
      }
    };

    fetchRestaurante();
  }, []);

  // 🔧 resize no entrar/sair fullscreen
  useEffect(() => {
    if (mapRef.current && typeof mapRef.current.resize === "function") {
      try {
        mapRef.current.resize();
      } catch (e) {
        console.warn("Erro ao tentar dar resize no mapa:", e);
      }
    }
  }, [fullscreen]);

  // socket.io: motoboys online e localização atualizada
  useEffect(() => {
    if (!restauranteId) return;

    const socket = io(SOCKET_URL);

    socket.on("connect", () => {
      console.log("✅ Socket conectado!", socket.id);
      socket.emit("joinRestaurante", { restauranteId });
    });

    socket.on("deliverersOnline", (data) => {
      console.log("📍 [MAPA] deliverersOnline recebido:", data);
      if (Array.isArray(data)) {
        const comLocalizacao = data.filter(
          (d) =>
            d.localizacao &&
            !isNaN(d.localizacao.latitude) &&
            !isNaN(d.localizacao.longitude)
        );

        const motoristasConvertidos = comLocalizacao.map((d) => ({
          ...d,
          latitude: d.localizacao.latitude,
          longitude: d.localizacao.longitude,
        }));

        setMotoristas(motoristasConvertidos);
      }
    });

    socket.on("localizacaoAtualizada", (data) => {
      console.log("📍 Localização recebida:", data);
      const latitude = parseFloat(data.latitude);
      const longitude = parseFloat(data.longitude);

      if (!isNaN(latitude) && !isNaN(longitude)) {
        setMotoristas((prev) => {
          const atualizados = prev.filter((m) => m._id !== data._id);
          return [...atualizados, { ...data, latitude, longitude }];
        });
      }
    });

    socket.on("connect_error", (err) => {
      console.error("❌ Erro na conexão com socket:", err.message);
    });

    return () => socket.disconnect();
  }, [restauranteId]);

  // Geocodifica pedidos (endereço -> lat/lon)
  useEffect(() => {
    const geocodificarPedidos = async () => {
      if (!pedidosMap || pedidosMap.length === 0) return;

      const geocodificados = await Promise.all(
        pedidosMap.map(async (pedido) => {
          try {
            const response = await axios.get(
              `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
                pedido.enderecoCliente
              )}.json`,
              {
                params: {
                  access_token: MAPBOX_TOKEN,
                  limit: 1,
                },
              }
            );

            if (response.data.features && response.data.features.length > 0) {
              const [lon, lat] =
                response.data.features[0].geometry.coordinates;
              return {
                ...pedido,
                latitude: lat,
                longitude: lon,
              };
            }

            return null;
          } catch (err) {
            console.error(`Erro ao geocodificar ${pedido._id}:`, err);
            return null;
          }
        })
      );

      setPedidos(geocodificados.filter(Boolean));
    };

    if (restauranteId) {
      geocodificarPedidos();
    }
  }, [restauranteId, pedidosMap]);

  // Foca no pedido selecionado (clique no card)
  useEffect(() => {
    if (!selectedPosition || !mapRef.current) return;
    const pedido = pedidos.find((p) => p._id === selectedPosition);
    if (pedido) {
      mapRef.current.flyTo({
        center: [pedido.longitude, pedido.latitude],
        zoom: 15,
        duration: 1500,
      });
    }
  }, [selectedPosition, pedidos]);

  if (!restauranteData) return null;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        overflow: "hidden",
      }}
    >
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: restauranteData.localizacao.longitude,
          latitude: restauranteData.localizacao.latitude,
          zoom: 14,
        }}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/streets-v11"
        style={{ width: "100%", height: "100%" }}
      >
        {/* Restaurante */}
        <Marker
          longitude={restauranteData.localizacao.longitude}
          latitude={restauranteData.localizacao.latitude}
        >
          <img src={restaurantePin} alt="Restaurante" style={{ width: 40 }} />
        </Marker>

        {/* Motoristas */}
        {motoristas
          .filter(
            (m) => !isNaN(m.latitude) && !isNaN(m.longitude)
          )
          .map((m) => (
            <Marker
              key={m._id || m.email}
              longitude={m.longitude}
              latitude={m.latitude}
            >
              <img
                src={capaceteIcon}
                alt="Motorista"
                style={{ width: 32, height: 32 }}
              />
            </Marker>
          ))}

        {/* Pedidos */}
        {pedidos
          .filter(
            (p) => !isNaN(p.latitude) && !isNaN(p.longitude)
          )
          .map((p) => (
            <React.Fragment key={p._id}>
              <Marker
                longitude={p.longitude}
                latitude={p.latitude}
                onClick={() => setPopupPedidoSelecionado(p)}
              >
                <div
                  style={
                    p.status === "em_rota"
                      ? {
                          backgroundColor: "blue",
                          color: "#fff",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: "bold",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }
                      : {
                          backgroundColor: "#1976d2",
                          color: "#fff",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: "bold",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }
                  }
                >
                  {p.numeroPedido}
                </div>
              </Marker>

              {popupPedidoSelecionado &&
                popupPedidoSelecionado._id === p._id && (
                  <Popup
                    anchor="top"
                    longitude={p.longitude}
                    latitude={p.latitude}
                    onClose={() => setPopupPedidoSelecionado(null)}
                    closeOnClick={false}
                  >
                    <div
                      style={{
                        minWidth: 220,
                        fontFamily: "Arial, sans-serif",
                      }}
                    >
                      <p style={{ margin: "4px 0" }}>
                        <strong>Pedido:</strong> {p.numeroPedido}
                      </p>
                      <p style={{ margin: "4px 0" }}>
                        <strong>Cliente:</strong> {p.nomeCliente}
                      </p>
                      <p style={{ margin: "4px 0" }}>
                        <strong>Endereço:</strong> {p.enderecoCliente}
                      </p>
                      <p style={{ margin: "4px 0 12px" }}>
                        <strong>Valor:</strong> R${" "}
                        {parseFloat(p.valorTotal || 0).toFixed(2)}
                      </p>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <button
                          onClick={() =>
                            console.log("🔄 Reencaminhar pedido", p._id)
                          }
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#f39c12",
                            border: "none",
                            borderRadius: 4,
                            color: "white",
                            cursor: "pointer",
                            fontWeight: "bold",
                          }}
                        >
                          Atribuir novamente
                        </button>

                        <button
                          onClick={() =>
                            console.log(
                              "💬 Enviar mensagem para",
                              p.nomeCliente
                            )
                          }
                          style={{
                            padding: "6px 12px",
                            backgroundColor: "#3498db",
                            border: "none",
                            borderRadius: 4,
                            color: "white",
                            cursor: "pointer",
                            fontWeight: "bold",
                          }}
                        >
                          Mensagem
                        </button>
                      </div>
                    </div>
                  </Popup>
                )}
            </React.Fragment>
          ))}
      </Map>
    </div>
  );
};

export default Mapa;
