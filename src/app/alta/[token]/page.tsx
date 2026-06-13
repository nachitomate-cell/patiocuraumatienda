import { AltaEmprendedorScreen } from "./AltaEmprendedorScreen";

export default async function AltaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AltaEmprendedorScreen token={token} />;
}
