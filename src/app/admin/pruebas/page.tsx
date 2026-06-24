import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { PruebasScreen } from "./PruebasScreen";

export default function PruebasPage() {
  return (
    <AuthGate>
      <AppShell>
        <PruebasScreen />
      </AppShell>
    </AuthGate>
  );
}
