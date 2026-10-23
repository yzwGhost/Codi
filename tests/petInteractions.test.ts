import { expect, it, vi } from 'vitest';
import { attachPetContextMenu } from '../src/main/petInteractions';

it('opens the pet menu from the native draggable region without showing the system menu', () => {
  let contextMenu: ((event: { preventDefault(): void }) => void) | undefined;
  const window = {
    on(name: string, listener: (event: { preventDefault(): void }) => void) {
      if (name === 'system-context-menu') contextMenu = listener;
    },
  };
  const openMenu = vi.fn();
  attachPetContextMenu(window, openMenu);

  const preventDefault = vi.fn();
  contextMenu?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(openMenu).toHaveBeenCalledOnce();
});
