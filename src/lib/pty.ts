/** Typed IPC + event bridge for the PTY backend. */

const inTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface SpawnOpts {
  cwd?: string;
  program?: string;
  args?: string[];
  /** Inject Claude Code lifecycle hooks so the app can track real status. */
  hooks?: boolean;
  rows: number;
  cols: number;
}

export async function ptySpawn(opts: SpawnOpts): Promise<string> {
  if (!inTauri) return `preview-${Math.random().toString(36).slice(2)}`;
  return invoke<string>("pty_spawn", {
    cwd: opts.cwd,
    program: opts.program,
    args: opts.args ?? [],
    hooks: opts.hooks ?? false,
    rows: opts.rows,
    cols: opts.cols,
  });
}

/** Last hook event for a claude session: working | waiting | needs_input | ended. */
export async function ptyHookStatus(id: string): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string | null>("pty_hook_status", { id });
}

export async function ptyWrite(id: string, data: string): Promise<void> {
  if (!inTauri) return;
  return invoke("pty_write", { id, data });
}

export async function ptyResize(id: string, rows: number, cols: number): Promise<void> {
  if (!inTauri) return;
  return invoke("pty_resize", { id, rows, cols });
}

export async function ptyKill(id: string): Promise<void> {
  if (!inTauri) return;
  return invoke("pty_kill", { id });
}

/** Subscribes to output for one session; returns an unsubscribe fn. */
export async function onPtyOutput(
  id: string,
  onData: (bytes: Uint8Array) => void,
  onExit: () => void,
): Promise<() => void> {
  if (!inTauri) {
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unOut = await listen<{ id: string; data: string }>("pty-output", (e) => {
    if (e.payload.id !== id) return;
    const bin = atob(e.payload.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    onData(bytes);
  });
  const unExit = await listen<{ id: string }>("pty-exit", (e) => {
    if (e.payload.id === id) onExit();
  });
  return () => {
    unOut();
    unExit();
  };
}

export async function repoLocalPath(repo: string): Promise<string | null> {
  if (!inTauri) return null;
  return invoke<string | null>("repo_local_path", { repo });
}

/** Native folder picker (for choosing the repo dir a Claude agent works in). */
export async function pickFolder(): Promise<string | null> {
  if (!inTauri) return "/Users/you/dev/example-repo"; // browser preview
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "Choose the repo folder" });
  return typeof picked === "string" ? picked : null;
}
