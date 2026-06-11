import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import * as Updates from "expo-updates";
import NetInfo from "@react-native-community/netinfo";

export default function UpdateGate({ children }) {
  const [status, setStatus] = useState("checking"); // checking | downloading | ready | offline | error | skip
  const [hint, setHint] = useState("Verificando atualizações…");

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        // Expo Go não se comporta igual build (APK). Evita falso-positivo.
        if (__DEV__) {
          if (mounted) setStatus("skip");
          return;
        }

        // Se estiver offline, entra direto no app.
        const net = await NetInfo.fetch();
        if (!net.isConnected) {
          if (mounted) {
            setStatus("offline");
            setHint("Sem internet. Abrindo o app…");
          }
          setTimeout(() => mounted && setStatus("skip"), 700);
          return;
        }

        if (mounted) {
          setStatus("checking");
          setHint("Verificando atualizações…");
        }

        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          if (mounted) {
            setStatus("downloading");
            setHint("Baixando atualização…");
          }

          await Updates.fetchUpdateAsync();

          if (mounted) {
            setHint("Aplicando atualização…");
          }

          // Reinicia já com update aplicado
          await Updates.reloadAsync();
          return;
        }

        if (mounted) setStatus("ready");
        setTimeout(() => mounted && setStatus("skip"), 300);
      } catch (e) {
        if (mounted) {
          setStatus("error");
          setHint("Não foi possível verificar atualizações. Abrindo o app…");
        }
        setTimeout(() => mounted && setStatus("skip"), 900);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, []);

  // Quando já pode abrir o app
  if (status === "skip") return children;

  // Tela bonita (dark)
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0B0F14",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Text style={{ fontSize: 24, fontWeight: "700", color: "#fff" }}>
        Movyo
      </Text>

      <Text style={{ marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.7)" }}>
        {hint}
      </Text>

      <View style={{ marginTop: 18 }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>

      <Text style={{ marginTop: 18, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
        {Platform.OS === "android" ? "Preparando para iniciar…" : "Aguarde…"}
      </Text>
    </View>
  );
}
