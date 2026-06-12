import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { AdminScreen } from "./AdminScreen";

export default function AdminPage() {
  return (
    <AppShell>
      <AuthGate>
        <AdminScreen />
      </AuthGate>
    </AppShell>
  );
}
