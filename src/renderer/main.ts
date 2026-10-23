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
  root.style.setProperty('--pet-scale', String(state.sizeScale ?? 1));

  const pet = (root.querySelector('.pet-image') as HTMLImageElement | null) ?? element('img', 'pet-image');
  pet.src = images[state.pet];
  pet.alt = state.pet === 'working' ? '工作中的桌宠' : state.pet === 'low' ? '额度快用完的桌宠' : '休息中的桌宠';
  pet.draggable = false;

  const card = (root.querySelector('.quota-card') as HTMLElement | null) ?? element('section', 'quota-card');
  if (!pet.isConnected || !card.isConnected) root.replaceChildren(pet, card);
  const status = [];
  if (state.lastUpdatedAt !== null) status.push(`上次更新 ${new Date(state.lastUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
  if (state.activityUnavailable) status.push('任务状态暂不可用');
  card.title = status.join(' · ');

  if (state.quotaUnavailable || state.windows === null) {
    if (!card.querySelector('.quota-unavailable')) card.replaceChildren(element('p', 'quota-unavailable', '额度暂不可用'));
  }
  if (state.windows && !state.quotaUnavailable) {
    const previousRows = new Map(Array.from(card.querySelectorAll<HTMLElement>('.quota-row')).map(row => [row.dataset.key, row]));
    const rows: HTMLElement[] = [];
    for (const window of state.windows) {
      const row = previousRows.get(window.key) ?? element('div', 'quota-row');
      row.dataset.key = window.key;
      row.title = `${window.limitId} · ${window.label} · 重置 ${localTime(window.resetsAt)}`;
      row.setAttribute('aria-label', `${window.label}剩余 ${window.remainingPercent}%，重置 ${localTime(window.resetsAt)}`);
      let fill = row.querySelector<HTMLElement>('.quota-fill');
      let amount = row.querySelector<HTMLElement>('.quota-amount');
      if (!fill || !amount) {
        const track = element('div', 'quota-track');
        fill = element('div', 'quota-fill');
        amount = element('strong', 'quota-amount');
        track.append(fill);
        row.append(track, amount);
      }
      amount.textContent = `${window.remainingPercent}%`;
      fill.style.width = `${window.remainingPercent}%`;
      fill.classList.toggle('quota-fill-low', window.remainingPercent <= 20);
      for (const decrease of state.decreases) {
        if (decrease.key !== window.key || seen.has(decrease.eventId)) continue;
        const floater = element('span', 'quota-decrease', `-${decrease.amountPercent}%`);
        floater.addEventListener('animationend', () => floater.remove(), { once: true });
        row.append(floater);
        seen.add(decrease.eventId);
      }
      rows.push(row);
    }
    if (card.children.length !== rows.length || rows.some((row, index) => card.children[index] !== row)) card.replaceChildren(...rows);
  }
}

declare global {
  interface Window {
    petBridge?: {
      onState(callback: (state: PetViewState) => void): () => void;
      refreshQuota(): Promise<void>;
      setAutostart(enabled: boolean): Promise<void>;
    };
  }
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  const root = document.getElementById('app')!;
  renderPetView({ windows: null, pet: 'idle', decreases: [], lastUpdatedAt: null, quotaUnavailable: true }, root);
  window.petBridge?.onState(state => renderPetView(state, root));
}
