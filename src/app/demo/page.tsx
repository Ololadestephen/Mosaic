import Link from "next/link";
import { RecordedCoverage } from "@/components/landing/recorded-coverage";

const bulletin =
  "https://content.govdelivery.com/accounts/USDHSCISA/bulletins/3a9a578";

export default function DemoPage() {
  return (
    <main className="entry-page">
      <header className="entry-header">
        <Link className="brand" href="/">
          Mosaic
        </Link>
        <nav aria-label="Demo sections" className="entry-nav demo-nav">
          <a href="#demo-board">Board</a>
          <a href="#demo-source">Source</a>
          <a href="#demo-review">Review</a>
          <a href="#demo-coverage">Coverage</a>
        </nav>
      </header>
      <section className="landing-walkthrough" aria-labelledby="demo-title">
        <div>
          <h1 id="demo-title" className="hero-headline">
            CrowdStrike outage response
          </h1>
          <p>
            Explore a read-only Mosaic board based on CISA’s July 19, 2024
            bulletin. The tasks are derived from the alert.
          </p>
          <a href={bulletin}>Read the original CISA bulletin</a>
        </div>
        <section
          id="demo-board"
          className="walkthrough-card"
          aria-labelledby="board-title"
        >
          <h2 id="board-title">Board</h2>
          <p className="walkthrough-label">To do</p>
          <ul>
            <li>
              Verify that outage recovery instructions come from legitimate
              sources
            </li>
          </ul>
        </section>
      </section>
      <section
        id="demo-source"
        className="landing-walkthrough"
        aria-labelledby="source-title"
      >
        <div>
          <h2 id="source-title">Compare source excerpts</h2>
          <p>
            Both excerpts come from the same bulletin. The second includes the
            employee phishing reminder.
          </p>
        </div>
        <div className="walkthrough-card">
          <h3>First excerpt</h3>
          <blockquote>
            “only follow instructions from legitimate sources.”
          </blockquote>
          <h3>Expanded excerpt</h3>
          <blockquote>
            “only follow instructions from legitimate sources.”{" "}
            <mark>
              “remind their employees to avoid clicking on phishing emails or
              suspicious links.”
            </mark>
          </blockquote>
        </div>
      </section>
      <section
        id="demo-review"
        className="landing-walkthrough"
        aria-labelledby="review-title"
      >
        <div>
          <h2 id="review-title">Review the proposed task</h2>
          <p>
            Verifying recovery instructions and warning employees are separate
            actions. This example shows how a reviewer can trace the additional
            action to the source.
          </p>
          <Link className="button" href="/#walkthrough">
            Try apply and undo
          </Link>
        </div>
        <div className="walkthrough-card">
          <p className="walkthrough-label">
            Illustrative proposal · Create task
          </p>
          <strong>
            Remind employees to avoid phishing emails and suspicious links
          </strong>
          <a href="#demo-source">See the supporting excerpt</a>
          <details>
            <summary>Example apply receipt</summary>
            <p>
              Before: no employee reminder task. After: reminder task created
              with status To do.
            </p>
          </details>
        </div>
      </section>
      <RecordedCoverage />
    </main>
  );
}
