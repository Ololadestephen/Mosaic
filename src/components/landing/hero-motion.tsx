"use client";

import BlurText from "../bits/BlurText";
import DotGrid from "../bits/DotGrid";
import RotatingText from "../bits/RotatingText";

// Decorative layers only: the page's visually hidden h1 carries the readable headline.
export function HeroBackdrop() {
  return (
    <div className="hero-backdrop" aria-hidden="true">
      <DotGrid
        dotSize={3}
        gap={24}
        baseColor="#dde1d3"
        activeColor="#4e654e"
        proximity={130}
        shockRadius={220}
        shockStrength={4}
      />
    </div>
  );
}

export function HeroHeadline() {
  return (
    <div className="hero-headline" aria-hidden="true">
      <BlurText
        text="Information changes."
        delay={90}
        animateBy="words"
        direction="bottom"
        className="hero-line"
      />
      <span className="hero-line hero-line--accent">
        Keep work{" "}
        <RotatingText
          texts={["in sync.", "cited.", "reviewed.", "reversible."]}
          mainClassName="hero-rotate"
          rotationInterval={2600}
          staggerDuration={0.02}
          splitBy="characters"
        />
      </span>
    </div>
  );
}
