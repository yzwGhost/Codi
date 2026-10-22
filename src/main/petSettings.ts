import type { Rectangle } from './windowState';

export const petScales = [0.75, 1, 1.25, 1.5] as const;
export type PetScale = typeof petScales[number];

export function parsePetSettings(raw: unknown): { position: Rectangle | null; scale: PetScale } {
  if (!raw || typeof raw !== 'object') return { position: null, scale: 1 };
  const data = raw as Record<string, unknown>;
  const scale = petScales.find(option => option === data.scale) ?? 1;
  const position = [data.x, data.y, data.width, data.height].every(value => typeof value === 'number' && Number.isFinite(value))
    ? { x: data.x as number, y: data.y as number, width: data.width as number, height: data.height as number }
    : null;
  return { position, scale };
}
