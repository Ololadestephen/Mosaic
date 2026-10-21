import Link from "next/link";
import { registrationOpen } from "@/server/env";

export const dynamic = "force-dynamic";

export default function Home() {
  const canRegister = registrationOpen();
  return (
    <main className="entry-page">
      <header className="entry-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Mosaic
        </Link>
        <Link href="/login">
          Sign in <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <section className="hero">
        <p className="eyebrow">A little clarity. A better way forward.</p>
        <h1>
          Information changes.
          <br />
          <em>Keep work in sync.</em>
        </h1>
        <p className="hero-description">
          Turn a changing brief into a considered next step. See what needs to
          change, know why, and keep the work that still matters.
        </p>
        <Link
          className="button primary"
          href={canRegister ? "/login?mode=register" : "/login"}
        >
          {canRegister ? "Create your workspace" : "Sign in to your workspace"}{" "}
          <span aria-hidden="true">↗</span>
        </Link>
        <p className="quiet">
          {canRegister
            ? "Your sources. Your review. Your call."
            : "Access is limited to approved workspaces."}
        </p>
        <div className="lifecycle" aria-label="Mosaic workflow">
          <span>
            <b>01</b> Bring a source
          </span>
          <span>
            <b>02</b> Review the change
          </span>
          <span>
            <b>03</b> Apply with care
          </span>
          <span>
            <b>04</b> Keep the history
          </span>
        </div>
      </section>
      <footer className="entry-footer">
        <p>Work, with a reason.</p>
        <p>A workspace that remembers why.</p>
      </footer>
    </main>
  );
}
