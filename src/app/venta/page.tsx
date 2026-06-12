import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { VentaScreen } from "./VentaScreen";

export default function VentaPage() {
  return (
    <AppShell>
      <AuthGate>
        <VentaScreen />
      </AuthGate>
    </AppShell>
  );
}
