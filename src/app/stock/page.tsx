import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { StockScreen } from "./StockScreen";

export default function StockPage() {
  return (
    <AuthGate>
      <AppShell>
        <StockScreen />
      </AppShell>
    </AuthGate>
  );
}
