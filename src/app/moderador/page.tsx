import { ModeradorScreen } from "./ModeradorScreen";

// Panel global de administración (negocios y usuarios). No usa el AppShell del
// POS ni su login: tiene su propia verificación de rol moderador.
export default function ModeradorPage() {
  return <ModeradorScreen />;
}
