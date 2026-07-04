import type { PanelTab } from './managementPanelData';

export {};

declare global {
  interface Window {
    petAgent?: {
      openChat: () => Promise<void>;
      openPanel: (tab?: PanelTab) => Promise<void>;
      beginPetDrag: () => Promise<void>;
      endPetDrag: () => Promise<void>;
      resizePet: (size: number) => Promise<void>;
      setChatPinned: (pinned: boolean) => Promise<void>;
      hideChat: () => Promise<void>;
      onPinnedChanged: (callback: (pinned: boolean) => void) => () => void;
      onPanelNavigate: (callback: (tab: PanelTab) => void) => () => void;
    };
  }
}
