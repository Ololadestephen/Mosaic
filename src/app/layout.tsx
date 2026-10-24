import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Self-hosted at build time, so pages load no third-party font requests.
const ui = Inter({ subsets: ["latin"], variable: "--font-ui" });
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Mosaic — Work, with a reason",
  description:
    "Keep your team's work aligned with changing information. Review cited changes and preserve what matters.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ui.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
