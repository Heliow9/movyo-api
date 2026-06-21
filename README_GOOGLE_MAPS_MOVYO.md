# Movyo — Ajuste Google Maps / Motoristas

## Variáveis necessárias

### API
No servidor da API, configure pelo menos:

```env
GOOGLE_MAPS_API_KEY=sua_chave_google_maps
```

Opcionalmente você pode separar chaves:

```env
GOOGLE_DIRECTIONS_API_KEY=sua_chave_google_directions
GOOGLE_GEOCODING_API_KEY=sua_chave_google_geocoding
```

### Desktop Front
No `.env` do Desktop:

```env
VITE_API_URL=https://api.movyo.delivery
VITE_PRINT_SERVICE_URL=http://localhost:9100
VITE_GOOGLE_MAPS_API_KEY=sua_chave_google_maps
```

Depois rode:

```bash
npm install
npm run build
npm run dist
```

### App Motorista
No build local/EAS:

```env
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=sua_chave_google_maps
GOOGLE_MAPS_API_KEY=sua_chave_google_maps
```

O arquivo `app.config.js` injeta a chave no `react-native-maps`, no Android/iOS e no `extra.googleMapsApiKey`.

## APIs do Google que devem estar habilitadas

- Maps JavaScript API
- Geocoding API
- Directions API
- Maps SDK for Android, se usar mapa nativo Android
- Maps SDK for iOS, se usar mapa nativo iOS

## Observação importante

As chaves reais foram removidas dos arquivos para evitar bloqueio no GitHub. Configure por `.env`, variável de ambiente do servidor ou secrets do EAS/GitHub.
