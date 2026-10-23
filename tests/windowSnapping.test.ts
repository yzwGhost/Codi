import { expect, it, vi } from 'vitest';
import { attachEdgeSnapping } from '../src/main/windowSnapping';

it('snaps the dragged window when Windows reports that moving ended', () => {
  const bounds = { x: 1478, y: 300, width: 420, height: 348 };
  let onDragEnd: (() => void) | undefined;
  const setBounds = vi.fn();
  const window = {
    hookWindowMessage(message: number, callback: () => void) {
      expect(message).toBe(0x0232);
      onDragEnd = callback;
    },
    getBounds: () => bounds,
    setBounds,
  };
  attachEdgeSnapping(window, () => ({ x: 0, y: 0, width: 1920, height: 1040 }));

  expect(setBounds).not.toHaveBeenCalled();
  onDragEnd?.();
  expect(setBounds).toHaveBeenCalledWith({ ...bounds, x: 1500 });
});

it('does not reposition a window dropped away from the edges', () => {
  let onDragEnd: (() => void) | undefined;
  const setBounds = vi.fn();
  attachEdgeSnapping({
    hookWindowMessage: (_message, callback) => { onDragEnd = callback; },
    getBounds: () => ({ x: 200, y: 200, width: 420, height: 348 }),
    setBounds,
  }, () => ({ x: 0, y: 0, width: 1920, height: 1040 }));
  onDragEnd?.();
  expect(setBounds).not.toHaveBeenCalled();
});
