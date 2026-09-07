import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { TermTab } from "../../stores/terminal";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, onPtyOutput } from "../../lib/pty";
import { useTheme } from "../../stores/theme";
import { useAgents } from "../../stores/agents";

const themes = {
  dark: {
    background: "#1a1a1e",
    foreground: "#ececf1",
    cursor: "#4d84f7",
    selectionBackground: "#33507d",
    black: "#1a1a1e",
    brightBlack: "#6e6e78",
  },
  light: {
    background: "#ffffff",
    foreground: "#1a1a1e",
    cursor: "#3574f0",
    selectionBackground: "#cfe0ff",
    black: "#1a1a1e",
    brightBlack: "#8e8e98",
  },
};

/**
 * One xterm.js instance bound to a PTY session. Stays mounted (hidden via
 * display:none) while inactive so scrollback survives tab switches.
 */
export function XtermView({ tab, active }: { tab: TermTab; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const resolved = useTheme((s) => s.resolved);

  // Spawn once on mount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: true,
      theme: themes[resolved],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — canvas renderer still works.
    }
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let unsub: (() => void) | null = null;
    let disposed = false;

    void (async () => {
      let id: string;
      try {
        id = await ptySpawn({
          cwd: tab.cwd,
          program: tab.kind === "claude" ? "claude" : undefined,
          rows: term.rows,
          cols: term.cols,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        term.write(`\x1b[31mFailed to start: ${msg}\x1b[0m\r\n`);
        if (tab.kind === "claude" && tab.notificationId) {
          useAgents.getState().setStatus(tab.notificationId, "failed", msg);
        }
        return;
      }
      if (disposed) {
        void ptyKill(id);
        return;
      }
      ptyIdRef.current = id;
      unsub = await onPtyOutput(
        id,
        (bytes) => term.write(bytes),
        () => {
          term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
          // Mark the linked agent run finished when a claude session ends.
          if (tab.kind === "claude" && tab.notificationId) {
            useAgents.getState().setStatus(tab.notificationId, "done", "Session ended");
          }
        },
      );
      term.onData((d) => void ptyWrite(id, d));

      // Seed the claude session with the notification context.
      if (tab.kind === "claude" && tab.seedPrompt) {
        setTimeout(() => {
          void ptyWrite(id, tab.seedPrompt!.replace(/\n/g, " ") + "\r");
        }, 900);
      }
    })();

    return () => {
      disposed = true;
      unsub?.();
      if (ptyIdRef.current) void ptyKill(ptyIdRef.current);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit + refocus when this tab becomes active or the panel resizes.
  useEffect(() => {
    if (!active) return;
    const refit = () => {
      const term = termRef.current;
      const fit = fitRef.current;
      const id = ptyIdRef.current;
      if (!term || !fit) return;
      try {
        fit.fit();
        if (id) void ptyResize(id, term.rows, term.cols);
      } catch {
        /* not visible yet */
      }
    };
    const raf = requestAnimationFrame(() => {
      refit();
      termRef.current?.focus();
    });
    const ro = new ResizeObserver(refit);
    if (hostRef.current) ro.observe(hostRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active]);

  // Follow theme changes.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themes[resolved];
  }, [resolved]);

  return <div ref={hostRef} className="h-full w-full" style={{ display: active ? "block" : "none" }} />;
}
