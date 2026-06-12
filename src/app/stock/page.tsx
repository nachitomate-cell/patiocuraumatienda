import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { StockScreen } from "./StockScreen";

export default function StockPage() {
  return (
    <AppShell>
      <AuthGate>
        <StockScreen />
      </AuthGate>
    </AppShell>
  );
}
