// src/components/tabTheme.ts
import { TabType } from "../store/tabStore";

// Type icon shown in the sidebar and the permission modal header.
export const TYPE_ICONS: Record<TabType, string> = {
  project: "◈",
  frontend: "</>",
  backend: "⊛",
  infra: "⚙",
  logs: "≡",
  database: "⊕",
};

// Accent color per tab type.
export const TYPE_COLORS: Record<TabType, string> = {
  project: "#3b82f6", // blue
  frontend: "#a855f7", // purple
  backend: "#4ade80", // green
  infra: "#f97316", // orange
  logs: "#fbbf24", // yellow
  database: "#22d3ee", // cyan
};
