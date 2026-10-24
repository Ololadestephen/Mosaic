// Deterministic test data only: a lobby with two seats, each an account with its own workspace.
import { randomUUID } from "node:crypto";
import { prepareDatabase } from "../integration/helpers";
import { signIn } from "../../src/server/auth/accounts";
import { closeLobby, openLobby } from "../../src/server/auth/lobby";
import { createWorkspace } from "../../src/server/workspaces";
import { closeDatabase } from "../../src/server/db/client";

await prepareDatabase();
const make = async (name: string) =>
  (
    await signIn(
      {
        name,
        email: `${randomUUID()}@mosaic.test`,
        password: "disposable-lobby-test-passphrase",
      },
      true,
    )
  ).account;
const owner = await make("Lobby owner");
const seats = [await make("Seat one"), await make("Seat two")];
for (const [index, seat] of seats.entries())
  await createWorkspace(
    { userId: seat.id },
    { name: `Seat ${index + 1} workspace` },
  );
await closeLobby();
const token = await openLobby(
  owner.id,
  seats.map((seat) => seat.id),
  new Date(Date.now() + 24 * 60 * 60 * 1000),
);
console.log(JSON.stringify({ token }));
await closeDatabase();
