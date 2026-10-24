"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { enterLobby, lobbySeats } from "@/client/commands";

type Seats = Awaited<ReturnType<typeof lobbySeats>>["seats"];

// The shared lobby token stays in the URL fragment, so it is kept out of request URLs and the link can be reopened.
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
    token.current = window.location.hash.slice(1);
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
