// MapContext.js
import { createContext, useContext, useState } from "react";

const MapContext = createContext();

export const useMapContext = () => useContext(MapContext);

export const MapProvider = ({ children }) => {
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [pedidosMap, setPedidosMap] = useState(null);

  return (
    <MapContext.Provider value={{ selectedPosition, setSelectedPosition, pedidosMap, setPedidosMap }}>
      {children}
    </MapContext.Provider>
  );
};
