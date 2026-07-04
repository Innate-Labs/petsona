import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { PanelTab } from './managementPanelData';
import { isTauri } from './lib/ipc';

type PinnedHandler = (pinned: boolean) => void;
type PanelNavigateHandler = (tab: PanelTab) => void;

const pinnedHandlers = new Set<PinnedHandler>();
const panelNavigateHandlers = new Set<PanelNavigateHandler>();

let chatPinned = false;

function emitPinnedChanged(pinned: boolean) {
  pinnedHandlers.forEach((handler) => handler(pinned));
}

function navigatePanel(tab?: PanelTab) {
  if (!tab) return;
  panelNavigateHandlers.forEach((handler) => handler(tab));
}

function panelRouteFor(tab?: PanelTab) {
  if (!tab || tab === 'home') return 'panel';
  return tab;
}

export function installPetAgentBridge() {
  window.petAgent = {
    async openChat() {
      if (isTauri()) {
        await invoke('open_float_chat');
        return;
      }
      window.location.hash = '#/float';
    },
    async openPanel(tab) {
      if (isTauri()) {
        await invoke('open_panel', { route: panelRouteFor(tab) });
      } else {
        window.location.hash = tab && tab !== 'home' ? `#/panel/${tab}` : '#/panel';
      }
      navigatePanel(tab);
    },
    async beginPetDrag() {
      if (isTauri()) await getCurrentWindow().startDragging();
    },
    async endPetDrag() {
      // Tauri ends native dragging when the pointer is released.
    },
    async resizePet(size) {
      if (isTauri()) await invoke('resize_pet_window', { size });
    },
    async setChatPinned(pinned) {
      chatPinned = pinned;
      emitPinnedChanged(pinned);
      if (isTauri()) {
        try {
          await getCurrentWindow().setAlwaysOnTop(pinned);
        } catch {
          // Pinning is a nice-to-have visual affordance; keep the UI state even if the platform call is unavailable.
        }
      }
    },
    async hideChat() {
      if (isTauri()) {
        await invoke('close_float_chat');
        return;
      }
      window.location.hash = '#/pet';
    },
    onPinnedChanged(callback) {
      pinnedHandlers.add(callback);
      callback(chatPinned);
      return () => pinnedHandlers.delete(callback);
    },
    onPanelNavigate(callback) {
      panelNavigateHandlers.add(callback);
      return () => panelNavigateHandlers.delete(callback);
    }
  };
}
