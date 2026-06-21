import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { FiadosScreen } from "./FiadosScreen";

export default function FiadosPage() {
  return (
    <AuthGate>
      <AppShell>
        <FiadosScreen />
      </AppShell>
    </AuthGate>
  );
}
