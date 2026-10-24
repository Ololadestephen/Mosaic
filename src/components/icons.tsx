import { ArrowUpRight, FileText, Plus } from "lucide-react";

// Decorative icons only: they never contribute to an accessible name.
const decorative = { "aria-hidden": true, focusable: false } as const;

export const Arrow = () => (
  <ArrowUpRight className="icon" size={14} strokeWidth={1.8} {...decorative} />
);
export const Add = () => (
  <Plus className="icon" size={15} strokeWidth={2} {...decorative} />
);
export const DocumentIcon = () => (
  <FileText
    className="document-icon"
    size={26}
    strokeWidth={1.4}
    {...decorative}
  />
);
