import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, sessionCookie } from "@/server/auth/accounts";
import { WorkspaceApp } from "@/components/workspace-app";

export const dynamic = "force-dynamic";

export default async function Application({
  params,
}: {
  params: Promise<{ view?: string[] }>;
}) {
  const account = await resolveSession(
    (await cookies()).get(sessionCookie)?.value,
  );
  if (!account) redirect("/login");
  return <WorkspaceApp account={account} view={(await params).view ?? []} />;
}
