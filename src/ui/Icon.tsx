/** Minimal inline SVG icon set (24×24, stroke based). */
const PATHS: Record<string, string> = {
  select: 'M5 3l13 8-6 1.5L9.5 19z',
  line: 'M4 20L20 4',
  rect: 'M4 6h16v12H4z',
  circle: 'M12 3a9 9 0 1 0 0.001 0z',
  freehand: 'M3 17c3-6 5-9 7-6s1 7 4 5 3-9 7-11',
  delete: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  duplicate: 'M8 8h12v12H8zM4 16V4h12',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  selectAll: 'M3 3h4M10 3h4M17 3h4v4M21 10v4M21 17v4h-4M14 21h-4M7 21H3v-4M3 14v-4M3 7V3',
  zoomIn: 'M10 3a7 7 0 1 0 0.001 0zM15 15l6 6M7 10h6M10 7v6',
  zoomOut: 'M10 3a7 7 0 1 0 0.001 0zM15 15l6 6M7 10h6',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M8 8h8v8H8z',
  actual: 'M4 6h16v12H4zM8 10v4M12 10v4M16 10v4',
  grid: 'M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18',
  snap: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0.001 0z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
