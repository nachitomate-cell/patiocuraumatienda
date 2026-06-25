import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { BoletaConfigScreen } from "./BoletaConfigScreen";

export default function BoletaPage() {
  return (
    <AuthGate>
      <AppShell>
        <BoletaConfigScreen />
      </AppShell>
    </AuthGate>
  );
}
