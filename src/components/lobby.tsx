"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { enterLobby, lobbySeats } from "@/client/commands";

type Seats = Awaited<ReturnType<typeof lobbySeats>>["seats"];

// The shared lobby token arrives in the URL fragment, so it never reaches request URLs. The page then removes it
// from the address bar and history, keeping it in this tab's session storage so a refresh before choosing a seat works.
const storedLink = "mosaic:lobby-link";

function readStored() {
  try {
    return window.sessionStorage.getItem(storedLink) ?? "";
  } catch {
    return "";
  }
}

function writeStored(value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(storedLink, value);
    else window.sessionStorage.removeItem(storedLink);
  } catch {
    // Without session storage the token lives in memory only; a refresh then needs the link again.
  }
}

export function Lobby() {
  const router = useRouter();
  const token = useRef("");
  const [seats, setSeats] = useState<Seats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const enter = useCallback(
    async (seat?: number) => {
      setBusy(true);
      setError("");
      try {
        await enterLobby(token.current, seat);
        // The seat cookie returns this judge from now on.
        writeStored(null);
        router.replace("/app");
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Could not open that seat.",
        );
        setSeats(
          (await lobbySeats(token.current).catch(() => null))?.seats ?? null,
        );
        setBusy(false);
      }
    },
    [router],
  );

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromLink = window.location.hash.slice(1);
    if (fromLink) {
      writeStored(fromLink);
      window.history.replaceState(null, "", window.location.pathname);
    }
    token.current = fromLink || readStored();
    lobbySeats(token.current)
      .then((result) => (result.yours ? enter() : setSeats(result.seats)))
      .catch((error) =>
        setError(
          error instanceof Error
            ? error.message
            : "This lobby link could not be used.",
        ),
      );
  }, [enter]);

  return (
    <main className="auth-page">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        Mosaic
      </Link>
      <section className="auth-card">
        <h1>Choose a seat</h1>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {seats ? (
          <div className="seat-grid">
            {seats.map(({ seat, available }) => (
              <button
                key={seat}
                className={available ? "primary" : undefined}
                disabled={!available || busy}
                onClick={() => enter(seat)}
              >
                Seat {seat}
                <span>{available ? "Available" : "In use"}</span>
              </button>
            ))}
          </div>
        ) : (
          !error && <p role="status">Opening the lobby…</p>
        )}
      </section>
    </main>
  );
}
