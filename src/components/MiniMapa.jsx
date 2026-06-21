import React, { useEffect, useRef, useState } from "react";
import { hasGoogleMapsKey, loadGoogleMaps } from "../utils/googleMapsLoader";

const MiniMapa = ({ latitude, longitude }) => {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [erro, setErro] = useState("");

  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasCoord = Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    let cancelled = false;
    if (!hasCoord || !hasGoogleMapsKey() || !mapNodeRef.current) return undefined;

    loadGoogleMaps(["places"])
      .then((google) => {
        if (cancelled || !mapNodeRef.current) return;
        const center = { lat, lng };
        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(mapNodeRef.current, {
            center,
            zoom: 16,
            clickableIcons: false,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
          });
          markerRef.current = new google.maps.Marker({ map: mapRef.current, position: center, title: "Localização" });
        } else {
          mapRef.current.setCenter(center);
          markerRef.current?.setPosition(center);
        }
      })
      .catch((error) => setErro(error?.message || "Erro ao carregar Google Maps."));

    return () => { cancelled = true; };
  }, [hasCoord, lat, lng]);

  if (!hasCoord) return null;

  if (!hasGoogleMapsKey() || erro) {
    return (
      <div
        style={{
          width: "100%",
          minHeight: 120,
          borderRadius: 12,
          border: "1px solid rgba(148, 163, 184, 0.35)",
          background: "#f8fafc",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          color: "#475569",
          padding: 12,
          boxSizing: "border-box",
        }}
      >
        Localização capturada: {lat.toFixed(6)}, {lng.toFixed(6)}
        <br />
        {!hasGoogleMapsKey() ? "Configure VITE_GOOGLE_MAPS_API_KEY para exibir o mapa." : erro}
      </div>
    );
  }

  return <div ref={mapNodeRef} style={{ width: "100%", minHeight: 160, borderRadius: 12, overflow: "hidden" }} />;
};

export default MiniMapa;
