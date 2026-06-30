import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
  Switch,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

import Logo from "../../assets/logo.png";
import AppVersionInfo from "../components/AppVersionInfo";
import { api } from "../api/api";
import { saveSession } from "../api/storage/session";
import { getAuthBlockMessageFromError, getRestauranteAccessBlockMessage, pickRestauranteFromPayload } from "../utils/licenseGuard";

import AsyncStorage from "@react-native-async-storage/async-storage";

const REMEMBER_KEY = "@movyo_garcom_remember_login_v1";

export default function LoginScreen({ onLogged }) {
  const [login, setLogin] = useState(""); // slug@telefone
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tipoLogin, setTipoLogin] = useState("garcom");

  const [remember, setRemember] = useState(true);

  const normalizeLogin = (value) => {
    const v = String(value || "").replace(/\s/g, ""); // remove espaços
    if (tipoLogin === "restaurante") return v.toLowerCase();
    if (!v.includes("@")) return v.toLowerCase();

    const [slug, tel] = v.split("@");
    const telNorm = String(tel || "").replace(/\D/g, "");
    return `${String(slug || "").toLowerCase()}@${telNorm}`;
  };

  const loginHint = useMemo(() => {
    const raw = normalizeLogin(login);
    if (tipoLogin === "restaurante") return raw && raw.includes("@") ? raw : null;
    if (!raw.includes("@")) return null;

    const [slug, tel] = raw.split("@");
    if (!slug || !tel) return null;
    return `${slug}@${tel}`;
  }, [login, tipoLogin]);

  const canSubmit = useMemo(() => {
    const id = normalizeLogin(login);
    const p = String(pin || "").trim();
    if (!id || !p) return false;
    if (!id.includes("@")) return false;

    if (tipoLogin === "garcom") {
      const [, tel] = id.split("@");
      if (!tel || tel.length < 8) return false;
      if (p.length < 4) return false;
      return true;
    }

    return p.length >= 6;
  }, [login, pin, tipoLogin]);

  // ✅ carrega login salvo ao abrir
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(REMEMBER_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setLogin(String(parsed?.login || ""));
            setTipoLogin(parsed?.tipoLogin === "restaurante" ? "restaurante" : "garcom");
          } catch {
            setLogin(String(saved));
          }
          setRemember(true);
        }
      } catch (e) {
        // silencioso
      }
    })();
  }, []);

  const entrar = async () => {
    const id = normalizeLogin(login);
    const p = String(pin || "").trim();

    if (!id || !p) return Alert.alert("Ops", tipoLogin === "restaurante" ? "Preencha email e senha." : "Preencha slug@telefone e PIN.");
    if (!id.includes("@")) return Alert.alert("Ops", tipoLogin === "restaurante" ? "Informe um email válido." : "Use no formato slug@telefone.");
    if (tipoLogin === "garcom" && p.length < 4) return Alert.alert("Ops", "PIN deve ter pelo menos 4 dígitos.");
    if (tipoLogin === "restaurante" && p.length < 6) return Alert.alert("Ops", "Senha deve ter pelo menos 6 caracteres.");

    setLoading(true);
    try {
      const res = tipoLogin === "restaurante"
        ? await api.post("/api/restaurantes/login", { email: id, senha: p })
        : await api.post("/api/garcons/login", { identificador: id, pin: p });

      const token = res?.data?.token;
      const restaurante = res?.data?.restaurante || pickRestauranteFromPayload(res?.data);
      const garcom = tipoLogin === "restaurante" ? null : res?.data?.garcom;

      if (!token) throw new Error("Token não retornou.");

      const bloqueioMsg = getRestauranteAccessBlockMessage(restaurante);
      if (bloqueioMsg) throw new Error(bloqueioMsg);

      await saveSession({ token, restaurante, garcom, tipo: tipoLogin });

      // ✅ lembrar login (apenas identificador)
      if (remember) await AsyncStorage.setItem(REMEMBER_KEY, JSON.stringify({ login: id, tipoLogin }));
      else await AsyncStorage.removeItem(REMEMBER_KEY);

      // ✅ só isso: AppNavigator troca para o stack logado
      onLogged?.();
    } catch (err) {
      const msg =
        getAuthBlockMessageFromError(err) ||
        err?.response?.data?.message ||
        err?.response?.data?.mensagem ||
        err?.message ||
        "Falha no login.";
      Alert.alert("Erro", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={["#ff3b8a", "#ff9b2d"]} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <View style={styles.logoOuter}>
            <View style={styles.logoWrapper}>
              <Image source={Logo} style={styles.logo} resizeMode="contain" />
            </View>
          </View>

          <Text style={styles.title}>Movyo Hub</Text>
          <Text style={styles.subtitle}>{tipoLogin === "restaurante" ? "Gestão mobile do restaurante" : "Atendimento rápido de mesas"}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.modeRow}>
            <Pressable onPress={() => setTipoLogin("garcom")} style={[styles.modeButton, tipoLogin === "garcom" && styles.modeButtonActive]}>
              <Text style={[styles.modeText, tipoLogin === "garcom" && styles.modeTextActive]}>Garçom</Text>
            </Pressable>
            <Pressable onPress={() => setTipoLogin("restaurante")} style={[styles.modeButton, tipoLogin === "restaurante" && styles.modeButtonActive]}>
              <Text style={[styles.modeText, tipoLogin === "restaurante" && styles.modeTextActive]}>Restaurante</Text>
            </Pressable>
          </View>

          {/* LOGIN */}
          <View style={styles.inputWrapper}>
            <Ionicons name="at-outline" size={20} color="#64748b" />
            <TextInput
              placeholder={tipoLogin === "restaurante" ? "example@gmail.com" : "slug@telefone"}
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              value={login}
              onChangeText={setLogin}
              onBlur={() => setLogin((v) => normalizeLogin(v))}
              style={styles.input}
              editable={!loading}
              returnKeyType="next"
            />
            {!!login && !loading && (
              <Pressable onPress={() => setLogin("")}>
                <Ionicons name="close-circle" size={20} color="#94a3b8" />
              </Pressable>
            )}
          </View>

          {!!loginHint && (
            <Text style={styles.previewText}>
              Vamos usar: <Text style={styles.previewBold}>{loginHint}</Text>
            </Text>
          )}

          {/* ✅ LEMBRAR LOGIN */}
          <View style={styles.rememberRow}>
            <Text style={styles.rememberText}>Lembrar meu login</Text>
            <Switch
              value={remember}
              onValueChange={setRemember}
              disabled={loading}
            />
          </View>

          {/* PIN */}
          <View style={[styles.inputWrapper, { marginTop: 12 }]}>
            <Ionicons name="lock-closed-outline" size={20} color="#64748b" />
            <TextInput
              placeholder={tipoLogin === "restaurante" ? "Senha do restaurante" : "PIN"}
              placeholderTextColor="#94a3b8"
              keyboardType={tipoLogin === "restaurante" ? "default" : "number-pad"}
              secureTextEntry={!showPin}
              value={pin}
              onChangeText={setPin}
              style={styles.input}
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={() => (canSubmit && !loading ? entrar() : null)}
            />
            <Pressable
              onPress={() => setShowPin((v) => !v)}
              disabled={loading}
            >
              <Ionicons
                name={showPin ? "eye-off-outline" : "eye-outline"}
                size={20}
                color="#64748b"
              />
            </Pressable>
          </View>

          {/* BOTÃO */}
          <Pressable
            onPress={entrar}
            disabled={loading || !canSubmit}
            style={({ pressed }) => [
              styles.button,
              (pressed || loading) && { opacity: 0.85 },
              (!canSubmit || loading) && { opacity: 0.65 },
            ]}
          >
            <Text style={styles.buttonText}>
              {loading ? "Entrando..." : "Entrar"}
            </Text>
          </Pressable>

          <Text style={styles.helper}>
            Exemplo: <Text style={{ fontWeight: "900" }}>{tipoLogin === "restaurante" ? "example@gmail.com" : "pizzadobairro@81999999999"}</Text>
          </Text>
        </View>

        <AppVersionInfo variant="light" style={styles.versionInfo} />
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 28 },

  logoOuter: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  logoWrapper: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#fff",
    borderWidth: 3,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  logo: { width: "100%", height: "100%" },

  title: { fontSize: 26, fontWeight: "900", color: "#fff" },
  subtitle: { marginTop: 6, fontSize: 14, color: "rgba(255,255,255,0.85)" },

  modeRow: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderRadius: 999,
    padding: 4,
    marginBottom: 14,
  },
  modeButton: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 999 },
  modeButtonActive: { backgroundColor: "#ff3b8a" },
  modeText: { fontWeight: "900", color: "#64748b" },
  modeTextActive: { color: "#fff" },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },

  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  input: { flex: 1, marginLeft: 10, fontSize: 15, color: "#0f172a" },

  previewText: { marginTop: 10, fontSize: 12, color: "#64748b" },
  previewBold: { fontWeight: "900", color: "#0f172a" },

  rememberRow: {
    marginTop: 12,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rememberText: { fontSize: 13, color: "#334155", fontWeight: "800" },

  button: {
    marginTop: 16,
    backgroundColor: "#ff3b8a",
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: "center",
    shadowColor: "#ff3b8a",
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  buttonText: { color: "#fff", fontWeight: "900", fontSize: 15 },

  helper: {
    marginTop: 14,
    fontSize: 12,
    textAlign: "center",
    color: "#64748b",
  },
  versionInfo: { marginTop: 16 },
});
