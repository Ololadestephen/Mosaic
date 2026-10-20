import { handleRequest } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function route(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return handleRequest(request, (await context.params).path);
}

export { route as GET, route as POST, route as PATCH };
