// src/navigation/AppNavigator.js
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, AppState, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import LoginScreen from "../screens/LoginScreen";
import HomeScreen from "../screens/HomeScreen";
import MesasScreen from "../screens/MesasScreen";
import PedidosScreen from "../screens/PedidosScreen";
import BalcaoScreen from "../screens/BalcaoScreen";
import ComandaScreen from "../screens/ComandaScreen";
import MeuPerfilScreen from "../screens/MeuPerfilScreen";
import HubRestauranteScreen from "../screens/HubRestauranteScreen";

import { clearSession, getSession } from "../api/storage/session";
import { api, authEvents } from "../api/api";
import { getAuthBlockMessageFromError, getRestauranteAccessBlockMessage, pickRestauranteFromPayload } from "../utils/licenseGuard";

const Stack = createNativeStackNavigator();

function isSessionUsable(session) {
  const token = String(session?.token || "").trim();
  const restId = session?.restaurante?._id || session?.restaurante?.id;
  if (!token || !restId) return false;
  if (session?.tipo === "restaurante") return true;
  const garcomId = session?.garcom?._id || session?.garcom?.id;
  return !!garcomId;
}


function restauranteFromMeResponse(data, session) {
  return pickRestauranteFromPayload(data) || data?.restaurante || data || session?.restaurante || null;
}

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff7ed" }}>
      <ActivityIndicator size="large" color="#ff3b8a" />
    </View>
  );
}

export default function AppNavigator() {
  const [loading, setLoading] = useState(true);
  const [isAuth, setIsAuth] = useState(false);
  const [sessionType, setSessionType] = useState("garcom");

  const refreshAuth = useCallback(async () => {
    try {
      const session = await getSession();
      setSessionType(session?.tipo === "restaurante" ? "restaurante" : "garcom");
      setIsAuth(isSessionUsable(session));
    } catch {
      setIsAuth(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const forceLogout = useCallback(async (message) => {
    await clearSession();
    setIsAuth(false);
    setSessionType("garcom");
    if (message) {
      setTimeout(() => Alert.alert("Acesso encerrado", message), 250);
    }
  }, []);

  const validateCurrentSession = useCallback(async () => {
    const current = await getSession();
    if (!isSessionUsable(current)) return;

    const localBlock = getRestauranteAccessBlockMessage(current?.restaurante);
    if (localBlock) {
      await forceLogout(localBlock);
      return;
    }

    // Garçom: não chama /api/garcons/app/me em background.
    // Em algumas versões da API essa rota responde “Sua sessão foi atualizada, entre novamente”
    // e quebra mesas/balcão mesmo com restaurante ativo e licença em dia.
    // O logout por bloqueio/vencimento continua acontecendo via interceptor quando uma rota
    // real da operação retornar claramente bloqueio ou licença vencida.
    if (current?.tipo !== "restaurante") return;

    try {
      const res = await api.get("/api/restaurantes/me");
      const restaurante = restauranteFromMeResponse(res?.data, current);
      const remoteBlock = getRestauranteAccessBlockMessage(restaurante);
      if (remoteBlock) await forceLogout(remoteBlock);
    } catch (err) {
      const blockMsg = getAuthBlockMessageFromError(err);
      if (blockMsg) await forceLogout(blockMsg);
    }
  }, [forceLogout]);

  useEffect(() => {
    const off = authEvents.on(async (ev) => {
      if (ev?.type === "AUTH_LOGIN") {
        setIsAuth(true);
        // Não valida garçom imediatamente para não disparar a rota /me problemática.
        setTimeout(() => validateCurrentSession(), 800);
        return;
      }

      if (ev?.type === "AUTH_LOGOUT") {
        await clearSession();
        setIsAuth(false);
        return;
      }

      if (ev?.type === "AUTH_LOGOUT_REQUIRED") {
        await forceLogout(ev?.message || "Sua sessão foi encerrada.");
      }
    });
    return off;
  }, [forceLogout, validateCurrentSession]);

  useEffect(() => {
    if (!isAuth) return;
    validateCurrentSession();

    const interval = setInterval(validateCurrentSession, 60000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") validateCurrentSession();
    });

    return () => {
      clearInterval(interval);
      sub?.remove?.();
    };
  }, [isAuth, validateCurrentSession]);

  if (loading) return <Splash />;

  if (!isAuth) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login">
          {(props) => (
            <LoginScreen
              {...props}
              onLogged={() => {
                refreshAuth();
                authEvents.emit({ type: "AUTH_LOGIN" });
              }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  if (sessionType === "restaurante") {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="HubRestaurante">
          {(props) => (
            <HubRestauranteScreen
              {...props}
              onLogout={async () => {
                await clearSession();
                setIsAuth(false);
                setSessionType("garcom");
              }}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home">
        {(props) => (
          <HomeScreen
            {...props}
            onLogout={async () => {
              await clearSession();
              setIsAuth(false);
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Mesas" component={MesasScreen} />
      <Stack.Screen name="Pedidos" component={PedidosScreen} />
      <Stack.Screen name="Balcao" component={BalcaoScreen} />
      <Stack.Screen name="Comanda" component={ComandaScreen} />
      <Stack.Screen name="MeuPerfil">
        {(props) => (
          <MeuPerfilScreen
            {...props}
            onLogout={async () => {
              await clearSession();
              setIsAuth(false);
            }}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
