import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { EmprendedoresScreen } from "./EmprendedoresScreen";

export default function EmprendedoresPage() {
  return (
    <AppShell>
      <AuthGate>
        <EmprendedoresScreen />
      </AuthGate>
    </AppShell>
  );
}
