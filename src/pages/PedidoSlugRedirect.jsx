import React from "react";
import Publico from "./Publico";

// Mantido por compatibilidade. A vitrine agora renderiza direto pela rota /p/:slug,
// evitando tela branca/redirect quebrado quando o slug é carregado.
export default function PedidoSlugRedirect() {
  return <Publico />;
}
