import { expect, it } from 'vitest';
import { parsePetSettings } from '../src/main/petSettings';

it('restores a saved position and a supported pet size', () => {
  expect(parsePetSettings({ x: 20, y: 30, width: 420, height: 368, scale: 1.25 })).toEqual({
    position: { x: 20, y: 30, width: 420, height: 368 }, scale: 1.25,
  });
});

it('uses default size for an old position file or an unsupported size', () => {
  expect(parsePetSettings({ x: 20, y: 30, width: 520, height: 380 }).scale).toBe(1);
  expect(parsePetSettings({ x: 20, y: 30, width: 520, height: 380, scale: 9 }).scale).toBe(1);
  expect(parsePetSettings(null)).toEqual({ position: null, scale: 1 });
});
