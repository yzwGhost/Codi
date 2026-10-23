type ContextMenuEvent = { preventDefault(): void };
type ContextMenuTarget = { on(name: 'system-context-menu', listener: (event: ContextMenuEvent) => void): unknown };

export function attachPetContextMenu(target: ContextMenuTarget, openMenu: () => void): void {
  target.on('system-context-menu', event => {
    event.preventDefault();
    openMenu();
  });
}
