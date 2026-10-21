"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "./commands";

export function AuthForm({
  initialRegister,
  registrationOpen,
}: {
  initialRegister: boolean;
  registrationOpen: boolean;
}) {
  const router = useRouter();
  const [register, setRegister] = useState(initialRegister);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await signIn(register, {
        email: data.get("email"),
        password: data.get("password"),
        ...(register ? { name: data.get("name") } : {}),
      });
      router.replace("/app");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
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
        <p className="eyebrow">A place for the work ahead</p>
        <h1>{register ? "Make room for clarity." : "Welcome back."}</h1>
        <p className="muted">
          {register
            ? "Create an account, then a workspace of your own."
            : "Pick up where your team left off."}
        </p>
        <form onSubmit={submit}>
          {register && (
            <label>
              Your name
              <input name="name" autoComplete="name" maxLength={80} required />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              required
            />
            <small>At least 12 characters.</small>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
          </button>
        </form>
        {registrationOpen && (
          <button
            className="text-button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        )}
        <p className="disclosure">
          Sources are stored in your workspace. Live AI, when enabled, sends the
          selected source and visible task context to the configured AI
          provider.
        </p>
      </section>
    </main>
  );
}
