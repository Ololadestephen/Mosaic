import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveSession, sessionCookie } from "@/server/auth/accounts";
import { enterOpenApp } from "@/server/auth/open-app";
import { reportError } from "@/server/diagnostics";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

// One click from the landing page opens the shared workspace. No sign-in form, no password.
export async function GET(request: Request) {
  const origin = new URL(env().APP_ORIGIN).origin;
  const existing = (await cookies()).get(sessionCookie)?.value;
  if (await resolveSession(existing))
    return NextResponse.redirect(new URL("/app", origin), 303);
  try {
    // On Vercel x-real-ip equals x-forwarded-for, which the platform overwrites with the connecting client's IP.
    const entered = await enterOpenApp(
      request.headers.get("x-real-ip") ?? "unknown",
    );
    const response = NextResponse.redirect(new URL("/app", origin), 303);
    response.cookies.set(sessionCookie, entered.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    reportError("open-app", error);
    return NextResponse.redirect(
      new URL("/demo?open=unavailable", origin),
      303,
    );
  }
}
