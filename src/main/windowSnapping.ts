import { snapWindowBounds, type Rectangle } from './windowState';

type SnappableWindow = {
  hookWindowMessage(message: number, callback: () => void): void;
  getBounds(): Rectangle;
  setBounds(bounds: Rectangle): void;
};

export function attachEdgeSnapping(window: SnappableWindow, getWorkArea: (bounds: Rectangle) => Rectangle): void {
  window.hookWindowMessage(0x0232, () => {
    const bounds = window.getBounds();
    const snapped = snapWindowBounds(bounds, getWorkArea(bounds));
    if (snapped.x !== bounds.x || snapped.y !== bounds.y) window.setBounds(snapped);
  });
}
