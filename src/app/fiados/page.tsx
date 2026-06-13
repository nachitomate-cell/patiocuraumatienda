import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { FiadosScreen } from "./FiadosScreen";

export default function FiadosPage() {
  return (
    <AppShell>
      <AuthGate>
        <FiadosScreen />
      </AuthGate>
    </AppShell>
  );
}
