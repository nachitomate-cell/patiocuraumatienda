import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { EntradasScreen } from "./EntradasScreen";

export default function EntradasPage() {
  return (
    <AppShell>
      <AuthGate>
        <EntradasScreen />
      </AuthGate>
    </AppShell>
  );
}
