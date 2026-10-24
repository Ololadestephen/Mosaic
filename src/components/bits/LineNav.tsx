"use client";

// Adapted from React Bits LineSidebar (https://reactbits.dev), Copyright (c) 2026 David Haz.
// Used under the MIT + Commons Clause License Condition v1.0 as part of this application; see
// https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md. The component is not redistributed separately.
// Changes: items are real links with aria-current, decorative numbering is hidden from assistive technology,
// an optional count badge is supported, and the pointer effect is skipped when reduced motion is requested.

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from "react";
import "./LineNav.css";

export type LineNavItem = {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
};

const smooth = (p: number) => p * p * (3 - 2 * p);

export function LineNav({
  items,
  label,
  proximityRadius = 70,
  smoothing = 110,
}: {
  items: LineNavItem[];
  label: string;
  proximityRadius?: number;
  smoothing?: number;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const targets = useRef<number[]>([]);
  const current = useRef<number[]>([]);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const active = items.findIndex((item) => item.active);
  const activeRef = useRef(active);

  // One rAF loop eases every item's --effect toward its target, so colour, shift and marker move together.
  const step = useRef<FrameRequestCallback>(() => undefined);
  useLayoutEffect(() => {
    step.current = (now) => {
      const dt = Math.min((now - last.current) / 1000, 0.05);
      last.current = now;
      const k = 1 - Math.exp(-dt / (smoothing / 1000));
      let moving = false;
      itemRefs.current.forEach((element, index) => {
        if (!element) return;
        const target = Math.max(
          targets.current[index] ?? 0,
          activeRef.current === index ? 1 : 0,
        );
        const from = current.current[index] ?? 0;
        const next = from + (target - from) * k;
        const settled = Math.abs(target - next) < 0.002;
        current.current[index] = settled ? target : next;
        element.style.setProperty(
          "--effect",
          current.current[index].toFixed(4),
        );
        if (!settled) moving = true;
      });
      frame.current = moving
        ? requestAnimationFrame((time) => step.current(time))
        : null;
    };
  });

  const start = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    last.current = performance.now();
    frame.current = requestAnimationFrame((time) => step.current(time));
  }, []);

  useEffect(() => {
    activeRef.current = active;
    start();
  }, [active, start]);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const onPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const list = listRef.current;
    if (!list) return;
    const y = event.clientY - list.getBoundingClientRect().top;
    itemRefs.current.forEach((element, index) => {
      if (!element) return;
      const center = element.offsetTop + element.offsetHeight / 2;
      targets.current[index] = smooth(
        Math.max(0, 1 - Math.abs(y - center) / proximityRadius),
      );
    });
    start();
  };

  const onPointerLeave = () => {
    targets.current = targets.current.map(() => 0);
    start();
  };

  return (
    <nav aria-label={label} className="line-nav">
      <ul
        ref={listRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        {items.map((item, index) => (
          <li
            key={item.href}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            style={{ "--effect": item.active ? 1 : 0 } as CSSProperties}
          >
            <Link
              href={item.href}
              aria-current={item.active ? "page" : undefined}
            >
              <span className="line-nav__marker" aria-hidden="true" />
              <span className="line-nav__index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
              {!!item.badge && (
                <span className="line-nav__badge">{item.badge}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
