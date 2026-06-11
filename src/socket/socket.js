import { io } from "socket.io-client";
import { API_URL } from "../api/config";

let socket;

export const connectSocket = (restauranteId) => {
  if (socket) return socket;

  socket = io(API_URL, {
    transports: ["websocket"],
    autoConnect: true,
  });

  socket.on("connect", () => {
    console.log("🔌 Socket conectado:", socket.id);
    socket.emit("joinRestaurante", { restauranteId });
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket desconectado");
  });

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
