import { Check, Quote } from "lucide-react";
import { GlowCard } from "../glow-card";

// A static illustration of one review, described once for assistive technology.
export function ReviewPreview() {
  return (
    <div
      className="review-preview"
      role="img"
      aria-label="Example review: a revised brief moves a launch date, Mosaic proposes two cited task changes, and one is applied with a before-and-after receipt."
    >
      <GlowCard className="preview-card">
        <div className="preview-head" aria-hidden="true">
          <span className="preview-dot" />
          <span>Launch brief</span>
          <span className="preview-pill">Version 2</span>
        </div>
        <div className="preview-diff" aria-hidden="true">
          <p className="preview-removed">Launch on 22 October.</p>
          <p className="preview-added">
            Launch on <mark>29 October</mark>, after the security review.
          </p>
        </div>
        <ul className="preview-proposals" aria-hidden="true">
          <li className="is-selected">
            <span className="preview-check">
              <Check size={12} strokeWidth={3} />
            </span>
            <div>
              <b>Launch</b>
              <span>
                Due date <s>Oct 22</s> → Oct 29
              </span>
              <em>
                <Quote size={11} strokeWidth={2} /> “Launch on 29 October”
              </em>
            </div>
          </li>
          <li>
            <span className="preview-check" />
            <div>
              <b>Book security review</b>
              <span>New task · due Oct 27</span>
              <em>
                <Quote size={11} strokeWidth={2} /> “after the security review”
              </em>
            </div>
          </li>
        </ul>
        <div className="preview-receipt" aria-hidden="true">
          <Check size={13} strokeWidth={2.4} /> 1 change applied · receipt saved
          · undo available
        </div>
      </GlowCard>
    </div>
  );
}
