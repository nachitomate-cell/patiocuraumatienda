import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { HistorialEmprendedorScreen } from "./HistorialEmprendedorScreen";

export default function HistorialEmprendedorPage() {
  return (
    <AuthGate>
      <AppShell>
        <HistorialEmprendedorScreen />
      </AppShell>
    </AuthGate>
  );
}
