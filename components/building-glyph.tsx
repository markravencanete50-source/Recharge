import { buildingFaces } from '@/lib/building-glyph';
export function BuildingGlyph() {
  return <svg viewBox="0 0 96 112" aria-hidden="true" className="building-glyph" stroke="var(--rc-stays-ink)" strokeWidth="1.8" strokeLinejoin="round"><path d={buildingFaces.ground} fill="none" opacity=".4"/><path d={buildingFaces.roof} fill="var(--rc-stays-wash)"/><path d={buildingFaces.front} fill="var(--rc-surface)"/><path d={buildingFaces.side} fill="var(--rc-stays-wash)"/><path d={buildingFaces.windows} fill="var(--rc-stays-ink)" strokeWidth="1"/><path d={buildingFaces.door} fill="var(--rc-stays-ink)"/></svg>;
}
