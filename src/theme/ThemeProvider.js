// src/theme/ThemeProvider.js
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { DEFAULT_THEME_ID, getPresetById } from "./palettes";
import { getThemePresetId, setThemePresetId } from "./themeStorage";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [presetId, setPresetId] = useState(DEFAULT_THEME_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await getThemePresetId();
      if (stored) setPresetId(stored);
      setReady(true);
    })();
  }, []);

  const preset = useMemo(() => getPresetById(presetId), [presetId]);

  const setPreset = useCallback(async (id) => {
    setPresetId(id);
    await setThemePresetId(id);
  }, []);

  const value = useMemo(() => {
    return {
      ready,
      presetId,
      preset,
      headerGradient: preset.colors,
      setPreset,
    };
  }, [ready, presetId, preset, setPreset]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      ready: true,
      presetId: DEFAULT_THEME_ID,
      preset: getPresetById(DEFAULT_THEME_ID),
      headerGradient: getPresetById(DEFAULT_THEME_ID).colors,
      setPreset: async () => {},
    };
  }
  return ctx;
}
