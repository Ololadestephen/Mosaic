"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signInWithLink } from "@/client/commands";

// The token travels in the URL fragment, which browsers never send to the server or in a Referer header.
export function AccessLink() {
  const router = useRouter();
  const [error, setError] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, "", window.location.pathname);
    signInWithLink(token)
      .then(() => router.replace("/app"))
      .catch((error) =>
        setError(
          error instanceof Error
            ? error.message
            : "This access link could not be used.",
        ),
      );
  }, [router]);
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
        {error ? (
          <>
            <h1>Link not accepted</h1>
            <p className="error" role="alert">
              {error}
            </p>
          </>
        ) : (
          <h1 role="status">Opening your workspace…</h1>
        )}
      </section>
    </main>
  );
}
