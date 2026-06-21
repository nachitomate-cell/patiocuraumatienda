import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { CrmScreen } from "./CrmScreen";

export default function CrmPage() {
  return (
    <AuthGate>
      <AppShell>
        <CrmScreen />
      </AppShell>
    </AuthGate>
  );
}
