import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { EtiquetasScreen } from "./EtiquetasScreen";

export default function EtiquetasPage() {
  return (
    <AppShell>
      <AuthGate>
        <EtiquetasScreen />
      </AuthGate>
    </AppShell>
  );
}
