export type Rectangle = { x: number; y: number; width: number; height: number };
export type WindowSize = { width: number; height: number };

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), Math.max(lower, upper));
}

export function clampWindowBounds(saved: Rectangle | null, workAreas: Rectangle[], size: WindowSize): Rectangle {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 };
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) {
    return { x: primary.x + primary.width - size.width - 20, y: primary.y + primary.height - size.height - 20, ...size };
  }
  const scores = workAreas.map(area => {
    const x = clamp(saved.x, area.x, area.x + area.width - size.width);
    const y = clamp(saved.y, area.y, area.y + area.height - size.height);
    return { x, y, score: (x - saved.x) ** 2 + (y - saved.y) ** 2 };
  });
  scores.sort((a, b) => a.score - b.score);
  const chosen = scores[0] ?? { x: primary.x, y: primary.y };
  return { x: chosen.x, y: chosen.y, ...size };
}

export function windowBoundsForQuota(current: Rectangle, workAreas: Rectangle[], rowCount: number): Rectangle {
  const area = workAreas.find(candidate =>
    current.x >= candidate.x && current.x < candidate.x + candidate.width
  ) ?? workAreas[0] ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const height = Math.min(Math.max(380, 80 + Math.max(0, rowCount) * 80), area.height - 30);
  return clampWindowBounds(
    { x: current.x, y: current.y + current.height - height, width: current.width, height },
    workAreas,
    { width: current.width, height },
  );
}
