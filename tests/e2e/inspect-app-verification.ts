import { readFile, writeFile } from "node:fs/promises";
import postgres from "postgres";
import {
  readAppFixture,
  verifyAppFixture,
} from "../../scripts/testsprite/verify-testsprite-app-fixture";
import { localTestDatabaseUrl } from "./local-database";
const raw = await localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const id = process.env.APP_WORKSPACE_ID;
if (!id || !/^[0-9a-f-]{36}$/i.test(id))
  throw new Error("Missing fixture workspace.");
const sql = postgres(raw, { max: 1, onnotice: () => {} });
try {
  const state = await readAppFixture(sql, id);
  const path = `.local/evidence/app-verification/baseline-${id}.json`;
  if (process.env.APP_PROOF_PHASE === "before") {
    if (state.tasks.length !== 2 || state.analysisRuns !== 0)
      throw new Error("Invalid fixture baseline.");
    await writeFile(path, JSON.stringify(state), { mode: 0o600 });
  } else {
    const baseline = JSON.parse(await readFile(path, "utf8"));
    if (process.env.APP_PROOF_PHASE === "review") {
      if (JSON.stringify(state) !== JSON.stringify(baseline))
        throw new Error("Review wrote domain data before approval.");
    } else if (process.env.APP_PROOF_PHASE === "after") {
      const result = verifyAppFixture(state, false, baseline);
      await writeFile(
        `.local/evidence/app-verification/proof-${id}.json`,
        JSON.stringify(result),
        { mode: 0o600 },
      );
    } else throw new Error("Unknown proof phase.");
  }
} finally {
  await sql.end();
}
