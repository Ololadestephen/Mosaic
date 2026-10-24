import { reportError } from "./diagnostics";
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
  signInWithLink,
  signOut,
} from "./auth/accounts";
import { env } from "./env";
import { workspaceRoute } from "./http/workspace-routes";
import { enterLobby, lobbySeats, seatCookie } from "./auth/lobby";
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
        ["register", "login", "link", "lobby", "lobby-seats"].includes(path[1]),
        "NOT_FOUND",
        "Route not found.",
      );
      const body = await readBody(request);
      // On Vercel x-real-ip equals x-forwarded-for, which the platform overwrites with the connecting client's IP.
      const client = request.headers.get("x-real-ip") ?? "unknown";
      const resume = cookieJar.get(seatCookie)?.value;
      if (path[1] === "lobby-seats")
        return NextResponse.json(await lobbySeats(body, client, resume), {
          headers: { "Cache-Control": "no-store" },
        });
      const cookie = {
        httpOnly: true,
        sameSite: "strict" as const,
        secure: process.env.NODE_ENV === "production",
        path: "/",
      };
      if (path[1] === "lobby") {
        const entered = await enterLobby(body, client, resume);
        const response = NextResponse.json({
          ...entered.account,
          seat: entered.seat,
        });
        response.cookies.set(sessionCookie, entered.token, {
          ...cookie,
          expires: entered.expiresAt,
        });
        if (entered.resume)
          response.cookies.set(seatCookie, entered.resume, {
            ...cookie,
            expires: entered.expiresAt,
          });
        return response;
      }
      const result =
        path[1] === "link"
          ? await signInWithLink(body, client)
          : await signIn(body, path[1] === "register");
      const response = NextResponse.json(result.account);
      response.cookies.set(sessionCookie, result.token, {
        ...cookie,
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
    if (error instanceof DomainError) {
      if (error.cause) reportError("http-request", error, requestId);
      return NextResponse.json(
        { error: error.message, code: error.code, requestId },
        { status: error.status },
      );
    }
    reportError("http-request", error, requestId);
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
