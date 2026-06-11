// src/components/AppVersionInfo.js
import React, { useMemo } from "react";
import { Text, StyleSheet } from "react-native";
import * as Updates from "expo-updates";

let appVersion = "1.0.0";
try {
  // Mantém a versão sempre sincronizada com o app.json, sem depender de lib nativa nova.
  // eslint-disable-next-line global-require
  const appConfig = require("../../app.json");
  appVersion = appConfig?.expo?.version || appConfig?.version || appVersion;
} catch (_) {
  appVersion = "1.0.0";
}

const shortId = (value) => {
  const id = String(value || "").trim();
  if (!id) return "embutido";
  return id.length > 8 ? id.slice(0, 8) : id;
};

export function getAppUpdateInfo() {
  return {
    version: appVersion,
    updateId: Updates?.updateId || null,
    runtimeVersion: Updates?.runtimeVersion || null,
    channel: Updates?.channel || null,
    createdAt: Updates?.createdAt || null,
  };
}

export default function AppVersionInfo({ variant = "light", style }) {
  const label = useMemo(() => {
    const info = getAppUpdateInfo();
    return `v${info.version} • update ${shortId(info.updateId)}`;
  }, []);

  return (
    <Text
      selectable
      numberOfLines={1}
      style={[
        styles.text,
        variant === "dark" ? styles.dark : styles.light,
        style,
      ]}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    marginTop: 10,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  light: { color: "rgba(255,255,255,0.68)" },
  dark: { color: "rgba(100,116,139,0.78)" },
});
