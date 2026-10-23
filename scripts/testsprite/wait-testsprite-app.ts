import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const statusSchema = z.object({
  context: z.string(),
  state: z.string(),
  description: z.string().nullable(),
  created_at: z.iso.datetime(),
  target_url: z.string().nullable(),
});
export function nativeAppStatus(raw: unknown, preparedAt: string) {
  const statuses = z.array(statusSchema).parse(raw);
  if (!Number.isFinite(Date.parse(preparedAt)))
    throw new Error("Invalid preparation time.");
  const status = statuses.find(
    (s) =>
      s.context === "TestSprite V3" &&
      Date.parse(s.created_at) >= Date.parse(preparedAt),
  );
  if (!status || status.state === "pending") return "pending";
  if (status.state !== "success")
    throw new Error("Native App reported a failure. No rerun was requested.");
  const target = status.target_url ? new URL(status.target_url) : null;
  if (
    status.description !== "All 3 tests passed" ||
    target?.origin !== "https://www.testsprite.com" ||
    !target.pathname.includes(
      "/projects/d9585a5d-bab0-438b-bda7-b6a9353aec2c/execution/",
    )
  )
    throw new Error(
      "Native App success does not match the intended three-test project.",
    );
  return "passed";
}
async function main() {
  const { SHA: sha, PREPARED_AT: preparedAt, GH_TOKEN: token } = process.env;
  if (!sha || !/^[a-f0-9]{40}$/.test(sha) || !preparedAt || !token)
    throw new Error("Missing native App wait context.");
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(
      `https://api.github.com/repos/Ololadestephen/Mosaic/commits/${sha}/statuses`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
        },
      },
    );
    if (!response.ok) throw new Error("Could not read native App status.");
    const statuses = await response.json();
    if (nativeAppStatus(statuses, preparedAt) === "passed") {
      const current = z
        .array(statusSchema)
        .parse(statuses)
        .find(
          (s) =>
            s.context === "TestSprite V3" &&
            Date.parse(s.created_at) >= Date.parse(preparedAt),
        )!;
      if (!process.env.APP_EVIDENCE_DIR)
        throw new Error("Missing evidence directory.");
      await writeFile(
        `${process.env.APP_EVIDENCE_DIR}/native-status.json`,
        JSON.stringify({ executionUrl: current.target_url, sha }),
        { mode: 0o600 },
      );
      console.log(
        "A fresh native three-test App status passed at the intended commit.",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  throw new Error(
    "No fresh native App result arrived. No event or rerun was sent.",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error("Native App status verification failed; details withheld.");
    process.exitCode = 1;
  });
}
