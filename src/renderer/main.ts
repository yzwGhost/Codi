import type { PetViewState } from '../shared/petState';
import './style.css';

const images = {
  working: new URL('../../assets/pet-working.png', import.meta.url).href,
  idle: new URL('../../assets/pet-idle.png', import.meta.url).href,
  low: new URL('../../assets/pet-low.png', import.meta.url).href,
};

const seenEvents = new WeakMap<HTMLElement, Set<number>>();

function localTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderPetView(state: PetViewState, root: HTMLElement): void {
  const seen = seenEvents.get(root) ?? new Set<number>();
  seenEvents.set(root, seen);
  root.replaceChildren();
  root.style.setProperty('--pet-scale', String(state.sizeScale ?? 1));

  const pet = element('img', 'pet-image');
  pet.src = images[state.pet];
  pet.alt = state.pet === 'working' ? '工作中的桌宠' : state.pet === 'low' ? '额度快用完的桌宠' : '休息中的桌宠';
  pet.draggable = false;
  let dragPoint: { x: number; y: number } | null = null;
  pet.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragPoint = { x: event.screenX, y: event.screenY };
    pet.setPointerCapture?.(event.pointerId);
    pet.classList.add('dragging');
  });
  pet.addEventListener('pointermove', event => {
    if (!dragPoint) return;
    const dx = event.screenX - dragPoint.x;
    const dy = event.screenY - dragPoint.y;
    dragPoint = { x: event.screenX, y: event.screenY };
    if (dx || dy) window.petBridge?.movePet(dx, dy);
  });
  const endDrag = () => { dragPoint = null; pet.classList.remove('dragging'); };
  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  pet.addEventListener('contextmenu', event => {
    event.preventDefault();
    void window.petBridge?.showPetMenu();
  });
  root.append(pet);

  const card = element('section', 'quota-card');
  const status = [];
  if (state.lastUpdatedAt !== null) status.push(`上次更新 ${new Date(state.lastUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
  if (state.activityUnavailable) status.push('任务状态暂不可用');
  card.title = status.join(' · ');

  if (state.quotaUnavailable || state.windows === null) {
    card.append(element('p', 'quota-unavailable', '额度暂不可用'));
  }
  if (state.windows && !state.quotaUnavailable) {
    for (const window of state.windows) {
      const row = element('div', 'quota-row');
      row.dataset.key = window.key;
      row.title = `${window.limitId} · ${window.label} · 重置 ${localTime(window.resetsAt)}`;
      row.setAttribute('aria-label', `${window.label}剩余 ${window.remainingPercent}%，重置 ${localTime(window.resetsAt)}`);
      const amount = element('strong', 'quota-amount', `${window.remainingPercent}%`);
      const track = element('div', 'quota-track');
      const fill = element('div', 'quota-fill');
      fill.style.width = `${window.remainingPercent}%`;
      if (window.remainingPercent <= 20) fill.classList.add('quota-fill-low');
      track.append(fill);
      row.append(track, amount);
      for (const decrease of state.decreases) {
        if (decrease.key !== window.key || seen.has(decrease.eventId)) continue;
        const floater = element('span', 'quota-decrease', `-${decrease.amountPercent}%`);
        row.append(floater);
        seen.add(decrease.eventId);
      }
      card.append(row);
    }
  }
  root.append(card);
}

declare global {
  interface Window {
    petBridge?: {
      onState(callback: (state: PetViewState) => void): () => void;
      refreshQuota(): Promise<void>;
      setAutostart(enabled: boolean): Promise<void>;
      showPetMenu(): Promise<void>;
      movePet(dx: number, dy: number): void;
    };
  }
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  const root = document.getElementById('app')!;
  renderPetView({ windows: null, pet: 'idle', decreases: [], lastUpdatedAt: null, quotaUnavailable: true }, root);
  window.petBridge?.onState(state => renderPetView(state, root));
}
