import { create } from "zustand";
import { kvGet, kvSet } from "../lib/ipc";

export interface Profile {
  name: string;
  email: string;
  handles: string;
  role: string;
}

interface ProfileState extends Profile {
  loaded: boolean;
  init: () => Promise<void>;
  save: (key: keyof Profile, value: string) => Promise<void>;
  /** Lower-cased tokens (name, first name, email, each handle) for text matching. */
  tokens: () => string[];
}

const KEYS: (keyof Profile)[] = ["name", "email", "handles", "role"];

/** Settings → About you. Read by the deterministic "is this about me" check. */
export const useProfile = create<ProfileState>((set, get) => ({
  name: "",
  email: "",
  handles: "",
  role: "",
  loaded: false,
  init: async () => {
    const [name, email, handles, role] = await Promise.all(KEYS.map((k) => kvGet(`profile:${k}`)));
    set({ name: name ?? "", email: email ?? "", handles: handles ?? "", role: role ?? "", loaded: true });
  },
  save: async (key, value) => {
    set({ [key]: value } as Partial<Profile>);
    await kvSet(`profile:${key}`, value);
  },
  tokens: () => {
    const { name, email, handles } = get();
    const out = new Set<string>();
    const add = (s: string) => {
      const t = s.trim().toLowerCase().replace(/^@/, "");
      if (t.length >= 3) out.add(t);
    };
    if (name) {
      add(name);
      const first = name.trim().split(/\s+/)[0];
      if (first && first.length >= 4) add(first); // "Edu" is too short to be safe, "Eduardo" is fine
    }
    if (email) {
      add(email);
      add(email.split("@")[0]);
    }
    for (const h of handles.split(/[,\n;]+/)) add(h.replace(/\(.*?\)/g, ""));
    return [...out];
  },
}));
