import { expect, it } from 'vitest';
import { clampWindowBounds } from '../src/main/windowState';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: -1600, y: 0, width: 1600, height: 900 };
const size = { width: 520, height: 380 };

it('places a new pet near the primary work area lower-right corner', () => {
  expect(clampWindowBounds(null, [primary], size)).toEqual({ x: 1380, y: 640, ...size });
});

it('keeps a saved position on another connected display', () => {
  expect(clampWindowBounds({ x: -1000, y: 200, ...size }, [primary, secondary], size)).toEqual({ x: -1000, y: 200, ...size });
});

it('moves a window from an unplugged display into the visible work area', () => {
  const value = clampWindowBounds({ x: -1500, y: 100, ...size }, [primary], size);
  expect(value.x).toBeGreaterThanOrEqual(primary.x);
  expect(value.x + size.width).toBeLessThanOrEqual(primary.x + primary.width);
});
