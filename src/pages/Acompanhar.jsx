// src/pages/Acompanhar.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { API_URL } from '../config';

mapboxgl.accessToken = 'SEU_TOKEN_AQUI'; // substitua pelo seu token público

export default function Acompanhar() {
  const { token } = useParams();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const mapContainer = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);

  useEffect(() => {
    const buscar = async () => {
      try {
        const res = await fetch(`${API_URL}/publico/acompanhar/${token}`);
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        setDados(json);
      } catch (e) {
        setErro(e.message);
      }
    };

    buscar();
    const interval = setInterval(buscar, 10000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (dados?.status === 'em_entrega' && dados.localizacao && mapContainer.current) {
      if (!map.current) {
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/streets-v11',
          center: [dados.localizacao.longitude, dados.localizacao.latitude],
          zoom: 15,
        });

        marker.current = new mapboxgl.Marker()
          .setLngLat([dados.localizacao.longitude, dados.localizacao.latitude])
          .addTo(map.current);
      } else {
        map.current.setCenter([dados.localizacao.longitude, dados.localizacao.latitude]);
        marker.current?.setLngLat([dados.localizacao.longitude, dados.localizacao.latitude]);
      }
    }
  }, [dados]);

  if (erro?.includes("entregue")) {
    return <Alert severity="success">✅ Pedido entregue com sucesso!</Alert>;
  }

  if (erro) return <Alert severity="error">❌ {erro}</Alert>;
  if (!dados) return <CircularProgress />;

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Entrega de {dados.cliente}
      </Typography>
      <Typography variant="body1">Entregador: {dados.entregador || 'Motoboy'}</Typography>
      <Typography>Status: {dados.status}</Typography>

      {dados.status === 'em_entrega' && (
        <Box ref={mapContainer} sx={{ height: 400, mt: 2, borderRadius: 2, overflow: 'hidden' }} />
      )}

      {dados.status === 'entregue' && (
        <Alert severity="success" sx={{ mt: 2 }}>
          ✅ Pedido entregue com sucesso! Obrigado por usar o RapiGO.
        </Alert>
      )}
    </Box>
  );
}
