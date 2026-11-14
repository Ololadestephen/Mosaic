import Link from "next/link";
import { History, Quote, ShieldCheck } from "lucide-react";
import { registrationOpen } from "@/server/env";
import { GlowCard } from "@/components/glow-card";
import { Arrow } from "@/components/icons";
import { HeroBackdrop, HeroHeadline } from "@/components/landing/hero-motion";
import { ReviewPreview } from "@/components/landing/review-preview";

import { PublicWalkthrough } from "@/components/landing/public-walkthrough";

export const dynamic = "force-dynamic";

const features = [
  {
    icon: Quote,
    title: "Cited to the exact words",
    body: "Every proposed change links to the passage in the revised source that justifies it.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing moves until you approve",
    body: "Select the changes you agree with. Mosaic applies them together and keeps a before-and-after receipt.",
  },
  {
    icon: History,
    title: "Undo that respects later work",
    body: "Roll back an applied change; anything edited since is kept and reported as a conflict.",
  },
];

const steps = [
  ["Bring a source", "Paste a brief, policy or plan. Every revision is kept."],
  [
    "Review the change",
    "Compare versions and read cited proposals for your tasks.",
  ],
  ["Apply with care", "Approve only what you choose, in one step."],
  ["Keep the history", "See who changed what, why, and undo safely."],
];

export default function Home() {
  const canRegister = registrationOpen();
  const start = canRegister ? "/login?mode=register" : "/login";
  const startLabel = canRegister
    ? "Create your workspace"
    : "Sign in to your workspace";
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
        <nav aria-label="Page sections" className="entry-nav">
          <a href="#how">How it works</a>
          <a href="#why">Why Mosaic</a>
          <Link href="/login" className="entry-signin">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="hero">
        <HeroBackdrop />
        <div className="hero-copy">
          <h1 className="sr-only">Information changes. Keep work in sync.</h1>
          <HeroHeadline />
          <p className="hero-lede">
            When a brief is revised, Mosaic proposes the task changes it
            implies, each cited to the exact words, and applies only what you
            approve.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/demo">
              Open demo <Arrow />
            </Link>
            <Link className="button quiet-button" href={start}>
              {startLabel}
            </Link>
            <a className="button quiet-button" href="#how">
              See how it works
            </a>
          </div>
        </div>
        <ReviewPreview />
      </section>

      <section id="why" className="feature-grid" aria-label="Why Mosaic">
        {features.map(({ icon: Icon, title, body }) => (
          <GlowCard className="feature-card" key={title}>
            <Icon
              className="feature-icon"
              size={20}
              strokeWidth={1.6}
              aria-hidden="true"
            />
            <h2>{title}</h2>
            <p>{body}</p>
          </GlowCard>
        ))}
      </section>

      <section id="how" className="steps" aria-labelledby="how-title">
        <h2 id="how-title">From revised brief to settled work</h2>
        <ol>
          {steps.map(([title, body], index) => (
            <li key={title}>
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <PublicWalkthrough />

      <section className="landing-faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Working in Mosaic</h2>
        <details>
          <summary>What happens when a source changes?</summary>
          <p>
            Mosaic keeps both revisions so reviewers can compare them. In
            enabled workspaces, Check coverage classifies changed passages and
            links them back to the source for review.
          </p>
        </details>
        <details>
          <summary>Can I try it without signing in?</summary>
          <p>
            Yes. The public walkthrough runs in your browser. Sign in to manage
            real sources and tasks in your workspace.
          </p>
        </details>
        <details>
          <summary>
            What if someone edits a task after I apply a change?
          </summary>
          <p>
            Mosaic checks for later edits before undoing a change and reports
            conflicts for you to review.
          </p>
        </details>
      </section>

      <section className="closing">
        <h2>Let the plan follow the facts.</h2>
        <Link className="button primary" href={start}>
          {startLabel} <Arrow />
        </Link>
      </section>

      <footer className="entry-footer">
        <span>© 2026 Mosaic</span>
        <Link href="/login">Sign in to Mosaic</Link>
      </footer>
    </main>
  );
}
