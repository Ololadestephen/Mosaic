import { notFound } from "next/navigation";
import { Lobby } from "@/components/lobby";
import { publicDemoToken } from "@/server/env";

export const dynamic = "force-dynamic";

export default function DemoPage() {
  if (!publicDemoToken()) notFound();
  return <Lobby publicDemo />;
}
