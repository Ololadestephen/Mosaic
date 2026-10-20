import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DomainError, requireCondition } from "@/domain/errors";
import {
  resolveSession,
  sessionCookie,
  signIn,
  signOut,
} from "./auth/accounts";
import { env } from "./env";
import { workspaceRoute } from "./http/workspace-routes";
import { readBody } from "./http/body";

export async function handleRequest(
  request: Request,
  path: string[],
): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const method = request.method;
    const changing = method !== "GET";
    if (changing)
      requireCondition(
        request.headers.get("origin") === new URL(env().APP_ORIGIN).origin,
        "FORBIDDEN",
        "This request must come from the Mosaic application.",
      );
    const cookieJar = await cookies();
    if (path[0] === "auth" && method === "POST") {
      if (path[1] === "logout") {
        await signOut(cookieJar.get(sessionCookie)?.value ?? "");
        const response = NextResponse.json({ ok: true });
        response.cookies.delete(sessionCookie);
        return response;
      }
      requireCondition(
        path[1] === "register" || path[1] === "login",
        "NOT_FOUND",
        "Route not found.",
      );
      const result = await signIn(
        await readBody(request),
        path[1] === "register",
      );
      const response = NextResponse.json(result.account);
      response.cookies.set(sessionCookie, result.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
      return response;
    }
    const account = await resolveSession(cookieJar.get(sessionCookie)?.value);
    requireCondition(account, "UNAUTHENTICATED", "Sign in to continue.");
    const actor = { userId: account.id };
    if (path[0] === "session" && method === "GET")
      return NextResponse.json(account);
    const result = await workspaceRoute(request, path, actor);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
    });
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        {
          error: "Check the request values and try again.",
          code: "INVALID_INPUT",
          requestId,
        },
        { status: 400 },
      );
    if (error instanceof DomainError)
      return NextResponse.json(
        { error: error.message, code: error.code, requestId },
        { status: error.status },
      );
    console.error({
      requestId,
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        error:
          "The request could not be completed. Your input has been preserved. Try again with the same operation.",
        code: "UNAVAILABLE",
        requestId,
      },
      { status: 503 },
    );
  }
}
