import "server-only";
import postgres from "postgres";
import { env } from "../env";

export type Database = ReturnType<typeof postgres>;
export type Transaction = postgres.TransactionSql;
let connection: Database | undefined;

export function db(): Database {
  connection ??= postgres(env().DATABASE_URL, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 8,
    onnotice: () => {},
  });
  return connection;
}

export async function closeDatabase() {
  if (connection) await connection.end();
  connection = undefined;
}
