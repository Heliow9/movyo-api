// PedidosContext.js
import { createContext, useState, useContext } from "react";

const PedidosContext = createContext();

export const PedidosProvider = ({ children }) => {
  const [atualizarPedidos, setAtualizarPedidos] = useState(false);

  const triggerAtualizacao = () => setAtualizarPedidos(prev => !prev);

  return (
    <PedidosContext.Provider value={{ atualizarPedidos, triggerAtualizacao }}>
      {children}
    </PedidosContext.Provider>
  );
};

export const usePedidos = () => useContext(PedidosContext);