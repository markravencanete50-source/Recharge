import type { ThinColumnSize } from './thin-table';

// The cleaning manager's schedule table (Cleans -> Schedule, and the Cleans tab in Guest relations) on a computer.
// E's round 9 sweep: at 1440 with the sidebar open it was wider than its card and "Last update" was cut off. As with
// the To-do list (lib/thin-table.ts), Status and Submitted forms keep their width and the text columns share the
// rest, never below their minimum while there is room; long text ends in "…". Every column stays.
export type CleanColumnKey = 'property' | 'cleaner' | 'status' | 'forms' | 'next' | 'update';
export const CLEAN_SCHEDULE_COLUMNS: readonly ({ key: CleanColumnKey; label: string } & ThinColumnSize)[] = [
  { key: 'property', label: 'Property', width: 240, grow: true, min: 150 },
  { key: 'cleaner', label: 'Cleaner', width: 140, min: 100 },
  { key: 'status', label: 'Status', width: 170, fixed: true },
  { key: 'forms', label: 'Submitted forms', width: 210, fixed: true },
  { key: 'next', label: 'Next action', width: 190, min: 120 },
  { key: 'update', label: 'Last update', width: 170, min: 140 },
];
