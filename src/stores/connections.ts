import { create } from "zustand";
import { providerStatus, providerConnect, providerDisconnect, type ProviderStatus } from "../lib/ipc";

interface ConnectionsState {
  statuses: ProviderStatus[];
  loaded: boolean;
  refresh: () => Promise<void>;
  connect: (provider: string, token: string) => Promise<string>;
  disconnect: (provider: string) => Promise<void>;
}

export const useConnections = create<ConnectionsState>((set, get) => ({
  statuses: [],
  loaded: false,
  refresh: async () => {
    const statuses = await providerStatus();
    set({ statuses, loaded: true });
  },
  connect: async (provider, token) => {
    const account = await providerConnect(provider, token);
    await get().refresh();
    return account;
  },
  disconnect: async (provider) => {
    await providerDisconnect(provider);
    await get().refresh();
  },
}));

export const connectedCount = (statuses: ProviderStatus[]) =>
  statuses.filter((s) => s.connected).length;
