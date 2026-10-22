import { expect, it } from 'vitest';
import { clampWindowBounds, petWindowSize, windowBoundsForQuota } from '../src/main/windowState';

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

it('sizes the window with the image, stacked bars, and selected scale', () => {
  expect(petWindowSize(2, 1)).toEqual({ width: 420, height: 368 });
  expect(petWindowSize(2, 1.5)).toEqual({ width: 630, height: 552 });
  expect(petWindowSize(5, 0.75)).toEqual({ width: 315, height: 321 });
});

it('resizes around the bottom edge and stays within the work area', () => {
  expect(windowBoundsForQuota({ x: 1380, y: 640, ...size }, [primary], 5, 1)).toEqual({ x: 1480, y: 592, width: 420, height: 428 });
  const many = windowBoundsForQuota({ x: 1380, y: 640, ...size }, [primary], 30, 1.5);
  expect(many.height).toBeLessThanOrEqual(primary.height - 30);
  expect(many.y).toBeGreaterThanOrEqual(primary.y);
});
