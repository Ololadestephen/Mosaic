import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [result] = await db()<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM schema_migrations WHERE name IN ('001_core.sql', '002_privacy_guards.sql', '003_analysis_provider.sql', '004_provider_errors.sql', '005_provider_error_details.sql', '006_raw_provider_response.sql')`;
    if (result.count !== 6) throw new Error("Migration required");
    return NextResponse.json(
      {
        status: "ready",
        version: "0.1.0",
        commit: process.env.MOSAIC_BUILD_COMMIT ?? "local",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
