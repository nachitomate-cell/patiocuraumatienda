import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { VariacionScreen } from "./VariacionScreen";

export default function VariacionPage() {
  return (
    <AuthGate>
      <AppShell>
        <VariacionScreen />
      </AppShell>
    </AuthGate>
  );
}
