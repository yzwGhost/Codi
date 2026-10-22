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

  const pet = element('img', 'pet-image');
  pet.src = images[state.pet];
  pet.alt = state.pet === 'working' ? '工作中的桌宠' : state.pet === 'low' ? '额度快用完的桌宠' : '休息中的桌宠';
  pet.draggable = false;
  root.append(pet);

  const card = element('section', 'quota-card');
  const heading = element('header', 'quota-heading');
  heading.append(element('span', 'quota-title', 'Codex 额度'));
  const refresh = element('button', 'refresh-button', '↻');
  refresh.type = 'button';
  refresh.title = '刷新额度';
  refresh.setAttribute('aria-label', '刷新额度');
  refresh.addEventListener('click', () => { void window.petBridge?.refreshQuota(); });
  heading.append(refresh);
  card.append(heading);

  if (state.quotaUnavailable || state.windows === null) {
    card.append(element('p', 'quota-unavailable', '额度暂不可用'));
  }
  if (state.windows && !state.quotaUnavailable) {
    for (const window of state.windows) {
      const row = element('div', 'quota-row');
      row.dataset.key = window.key;
      row.append(element('span', 'quota-label', `${window.limitId} · ${window.label}`));
      const amount = element('strong', 'quota-amount', `${window.remainingPercent}%`);
      row.append(amount);
      const track = element('div', 'quota-track');
      const fill = element('div', 'quota-fill');
      fill.style.width = `${window.remainingPercent}%`;
      if (window.remainingPercent <= 20) fill.classList.add('quota-fill-low');
      track.append(fill);
      row.append(track, element('span', 'quota-reset', `重置 ${localTime(window.resetsAt)}`));
      for (const decrease of state.decreases) {
        if (decrease.key !== window.key || seen.has(decrease.eventId)) continue;
        const floater = element('span', 'quota-decrease', `-${decrease.amountPercent}%`);
        row.append(floater);
        seen.add(decrease.eventId);
      }
      card.append(row);
    }
  }
  if (state.lastUpdatedAt !== null) {
    card.append(element('footer', 'quota-updated', `上次更新 ${new Date(state.lastUpdatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`));
  }
  if (state.activityUnavailable) card.append(element('p', 'activity-unavailable', '任务状态暂不可用'));
  root.append(card);
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
