"use client";
import { createElement } from "react";
import type { DepartmentTone } from "@/lib/workspace-map";
import { departmentGlyphs, iconNodes } from "@/lib/artwork";
export function DepartmentIllustration({
  department,
}: {
  department: DepartmentTone;
}) {
  return (
    <span
      className="department-illustration"
      data-department={department}
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
        {iconNodes[departmentGlyphs[department]].map(([tag, attrs], i) =>
          createElement(tag, { ...attrs, key: i }),
        )}
      </svg>
    </span>
  );
}
