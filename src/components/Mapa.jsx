import React, { useEffect, useRef, useState } from "react";
import { hasGoogleMapsKey, loadGoogleMaps } from "../utils/googleMapsLoader";

const Mapa = ({ fullscreen = false, latitude = -8.063, longitude = -34.877, zoom = 13 }) => {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!hasGoogleMapsKey() || !mapNodeRef.current) return undefined;
    const center = { lat: Number(latitude), lng: Number(longitude) };

    loadGoogleMaps(["places", "geometry"])
      .then((google) => {
        if (cancelled || !mapNodeRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(mapNodeRef.current, {
            center,
            zoom,
            clickableIcons: false,
            fullscreenControl: true,
            mapTypeControl: false,
            streetViewControl: false,
          });
          markerRef.current = new google.maps.Marker({ map: mapRef.current, position: center });
        } else {
          mapRef.current.setCenter(center);
          markerRef.current?.setPosition(center);
        }
      })
      .catch((error) => setErro(error?.message || "Erro ao carregar Google Maps."));

    return () => { cancelled = true; };
  }, [latitude, longitude, zoom]);

  if (!hasGoogleMapsKey() || erro) {
    return (
      <div
        style={{
          width: "100%",
          height: fullscreen ? "70vh" : 320,
          borderRadius: 16,
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: "linear-gradient(135deg, #f8fafc, #eef2ff)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          color: "#475569",
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <div>
          <strong>Mapa Google aguardando configuração</strong>
          <br />
          {!hasGoogleMapsKey() ? "Configure VITE_GOOGLE_MAPS_API_KEY no ambiente do Desktop." : erro}
        </div>
      </div>
    );
  }

  return <div ref={mapNodeRef} style={{ width: "100%", height: fullscreen ? "70vh" : 320, borderRadius: 16, overflow: "hidden" }} />;
};

export default Mapa;
