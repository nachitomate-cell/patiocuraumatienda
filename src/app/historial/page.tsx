import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { HistorialScreen } from "./HistorialScreen";

export default function HistorialPage() {
  return (
    <AuthGate>
      <AppShell>
        <HistorialScreen />
      </AppShell>
    </AuthGate>
  );
}
