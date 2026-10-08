import { createContext, useContext } from "react";
import type { HomeToolTarget } from "../../lib/home-tools";

// Lets a card inside a page open another place (a Work view, a tab inside it, another page), or
// bring a section further down the same page into view, the way a Home tool does.
export const WorkJumpContext = createContext<((target: HomeToolTarget) => void) | null>(null);
export const useWorkJump = () => useContext(WorkJumpContext);
