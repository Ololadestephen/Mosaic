// Operator tool for private access. Only hashes are stored; a new link is written to a new owner-only file so it
// never reaches terminal or CI logs. Sessions started from a link or the lobby end no later than it.
// Usage (DATABASE_URL and APP_ORIGIN set), via node --conditions=react-server --import tsx scripts/access-link.ts:
//   issue <email> <expires-YYYY-MM-DD> <out-file>        one account's private link
//   revoke <email>                                       that account's links and every session
//   lobby-open <owner-email> <expires-YYYY-MM-DD> <out-file> <seat-email>...   one shared link with seats
//   seat-release <seat>                                  free an abandoned seat (ends its sessions)
//   seat-revoke <seat>                                   remove a seat entirely
//   lobby-close                                          close the lobby and end every seat's access
import { writeFile } from "node:fs/promises";
import { issueAccessLink, revokeAccess } from "../src/server/auth/accounts";
import {
  closeLobby,
  openLobby,
  releaseSeat,
  revokeSeat,
} from "../src/server/auth/lobby";
import { closeDatabase, db } from "../src/server/db/client";

const [command, ...args] = process.argv.slice(2);
const date = /^\d{4}-\d{2}-\d{2}$/;
const fail = () => {
  throw new Error(
    "Usage: access-link.ts issue|revoke|lobby-open|seat-release|seat-revoke|lobby-close (see file header)",
  );
};

async function userId(email: string) {
  const [user] = await db()<
    { id: string }[]
  >`SELECT id FROM users WHERE email = ${email.toLowerCase()}`;
  if (!user) throw new Error("No account uses that email.");
  return user.id;
}

async function writeLink(out: string, path: string, token: string) {
  const origin = new URL(process.env.APP_ORIGIN ?? "").origin;
  await writeFile(out, `${origin}/${path}#${token}\n`, {
    mode: 0o600,
    flag: "wx",
  });
}

const endOf = (day: string) => new Date(`${day}T23:59:59Z`);
const seatNumber = (value?: string) =>
  /^\d{1,2}$/.test(value ?? "") ? Number(value) : fail();

try {
  if (command === "issue") {
    const [email, expires, out] = args;
    if (!email || !out || !date.test(expires ?? "")) fail();
    await writeLink(
      out,
      "access",
      await issueAccessLink(await userId(email), endOf(expires)),
    );
    console.log(`Access link written to ${out}; it expires ${expires}.`);
  } else if (command === "revoke") {
    if (!args[0]) fail();
    const removed = await revokeAccess(await userId(args[0]));
    console.log(`Access revoked: removed ${removed} link and session records.`);
  } else if (command === "lobby-open") {
    const [owner, expires, out, ...seatEmails] = args;
    if (!owner || !out || !date.test(expires ?? "") || !seatEmails.length)
      fail();
    const seats = [];
    for (const email of seatEmails) seats.push(await userId(email));
    await writeLink(
      out,
      "lobby",
      await openLobby(await userId(owner), seats, endOf(expires)),
    );
    console.log(
      `Lobby link with ${seats.length} seats written to ${out}; it expires ${expires}.`,
    );
  } else if (command === "seat-release") {
    const removed = await releaseSeat(seatNumber(args[0]));
    console.log(`Seat ${args[0]} released: removed ${removed} records.`);
  } else if (command === "seat-revoke") {
    const removed = await revokeSeat(seatNumber(args[0]));
    console.log(`Seat ${args[0]} revoked: removed ${removed} records.`);
  } else if (command === "lobby-close") {
    console.log(`Lobby closed: removed ${await closeLobby()} records.`);
  } else fail();
} finally {
  await closeDatabase();
}
