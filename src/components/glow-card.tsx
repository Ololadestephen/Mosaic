"use client";

import type { CSSProperties, ReactNode } from "react";
import SpotlightCard from "./bits/SpotlightCard";

// Mosaic's card surface: a soft sage spotlight follows the pointer and the edge lights up nearby.
// SpotlightCard pauses itself when reduced motion is requested.
export function GlowCard({
  className,
  role,
  children,
}: {
  className: string;
  role?: "article";
  children: ReactNode;
}) {
  return (
    <SpotlightCard
      theme="light"
      className={`glow-card ${className}`}
      role={role}
      spotlightColor="#4e654e"
      intensity={0.14}
      spotlightSize={260}
      borderGlow={0.55}
      style={
        {
          "--spotlight-card-surface": "var(--surface)",
          "--spotlight-card-border": "var(--line)",
          "--spotlight-card-shadow":
            "0 1px 2px rgb(41 45 40 / 4%), 0 14px 30px -22px rgb(41 45 40 / 22%)",
        } as CSSProperties
      }
    >
      {children}
    </SpotlightCard>
  );
}
