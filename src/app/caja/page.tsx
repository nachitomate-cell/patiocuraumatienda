import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { CajaScreen } from "./CajaScreen";

export default function CajaPage() {
  return (
    <AuthGate>
      <AppShell>
        <CajaScreen />
      </AppShell>
    </AuthGate>
  );
}
