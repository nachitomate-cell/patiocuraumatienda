import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { PorEmprendedorScreen } from "./PorEmprendedorScreen";

export default function PorEmprendedorPage() {
  return (
    <AuthGate>
      <AppShell>
        <PorEmprendedorScreen />
      </AppShell>
    </AuthGate>
  );
}
