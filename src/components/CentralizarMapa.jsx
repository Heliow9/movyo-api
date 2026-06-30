import React from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const CentralizarMapa = ({ marcadores }) => {
  const map = useMap();

  const centralizar = () => {
    if (marcadores.length === 0) return;

    const bounds = L.latLngBounds(
      marcadores.map((m) => [m.latitude, m.longitude])
    );

    map.fitBounds(bounds, { padding: [50, 50] });
  };

  return (
    <button
      onClick={centralizar}
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 1000,
        background: 'white',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid #ccc',
        cursor: 'pointer'
      }}
    >
      Centralizar Mapa
    </button>
  );
};

export default CentralizarMapa;
