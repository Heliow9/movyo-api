// src/context/UIContext.js
import React, { createContext, useState, useContext } from "react";

const UIContext = createContext();

export const UIProvider = ({ children }) => {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <UIContext.Provider value={{ fullscreen, setFullscreen }}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => useContext(UIContext);
