"use client";
import { createElement } from "react";
import type { LucideIcon } from "lucide-react";
import type { ModuleId } from "@/lib/modules";
import { WORKSPACE_MAP } from "@/lib/workspace-map";
import { featureGlyphs, iconNodes } from "@/lib/artwork";
export function ToolIllustration({
  id,
  className = "",
}: {
  id: ModuleId;
  className?: string;
  fallback?: LucideIcon;
}) {
  return (
    <span
      className={"tool-illustration " + className}
      data-department={WORKSPACE_MAP[id].tone}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {iconNodes[featureGlyphs[id]].map(([tag, attrs], i) =>
          createElement(tag, { ...attrs, key: i }),
        )}
      </svg>
    </span>
  );
}
