import { useEffect, useState } from "react";
import { create } from "zustand";
import { ArrowLeft, ArrowRight, PartyPopper, Rocket, SkipForward, X } from "lucide-react";
import { kvGet, kvSet } from "../../lib/ipc";
import { PROVIDER_META } from "../connections/providerMeta";
import { ConnectionCard } from "../connections/ConnectionCard";
import { SlackConnectionCard } from "../connections/SlackConnectionCard";
import { CalendarCard } from "../connections/CalendarCard";
import { useConnections, connectedCount } from "../../stores/connections";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/utils";

interface OnboardingState {
  open: boolean;
  start: () => void;
  close: () => void;
  /** Opens automatically on first launch (until completed or skipped once). */
  maybeAutoStart: () => Promise<void>;
}

export const useOnboarding = create<OnboardingState>((set) => ({
  open: false,
  start: () => set({ open: true }),
  close: () => {
    set({ open: false });
    void kvSet("onboarding_done", "1");
  },
  maybeAutoStart: async () => {
    const done = await kvGet("onboarding_done");
    if (!done) set({ open: true });
  },
}));

// steps: 0 = welcome, 1..n = one per provider, n+1 = finish
export function Onboarding() {
  const { open, close } = useOnboarding();
  const statuses = useConnections((s) => s.statuses);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const providers = PROVIDER_META;
  const lastStep = providers.length + 1;
  const provider = step >= 1 && step <= providers.length ? providers[step - 1] : null;

  // On a provider step, Next unlocks only once the connection is verified.
  // Unavailable providers (gcal until Phase 3) have nothing to verify.
  const providerConnected = provider
    ? (statuses.find((s) => s.id === provider.id)?.connected ?? false)
    : false;
  // Calendar connects via macOS (not a token in `statuses`), so it never gates.
  const mustConnect =
    provider !== null && provider.available && provider.id !== "gcal" && !providerConnected;

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="animate-pop-in flex max-h-[80vh] w-[640px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-pop">
        {/* header */}
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-xs font-bold text-accent-fg">
            F
          </div>
          <div className="flex-1">
            <h2 className="text-[14px] font-semibold tracking-tight">
              {step === 0 && "Welcome to FLDSMDPR"}
              {provider && `Connect ${provider.name}`}
              {step === lastStep && "You're all set"}
            </h2>
            <p className="text-xs text-ink-3">
              Setup · step {step + 1} of {lastStep + 1}
            </p>
          </div>
          <button
            onClick={close}
            title="Skip setup — you can re-run it anytime from Settings"
            className="cursor-default rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* progress */}
        <div className="flex gap-1 px-6 pt-4">
          {Array.from({ length: lastStep + 1 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-pill transition-colors duration-300",
                i <= step ? "bg-accent" : "bg-surface-3",
              )}
            />
          ))}
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Rocket size={22} />
              </div>
              <h3 className="text-[16px] font-semibold">One inbox for everything actionable</h3>
              <p className="max-w-md text-[13px] leading-5.5 text-ink-2">
                FLDSMDPR pulls PR reviews, Slack mentions, Linear tickets, and calendar events into a
                single prioritized inbox. This guide walks you through connecting each tool — where to
                create the key, which scopes to grant, and where to paste it. Each connection takes about
                two minutes, and you can skip any of them and come back later from{" "}
                <span className="font-medium text-ink">Settings → Connections</span>.
              </p>
            </div>
          )}

          {provider &&
            (provider.id === "slack" ? (
              <SlackConnectionCard defaultExpanded />
            ) : provider.id === "gcal" ? (
              <CalendarCard defaultExpanded />
            ) : (
              <ConnectionCard meta={provider} defaultExpanded />
            ))}

          {step === lastStep && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-success/12 text-success">
                <PartyPopper size={22} />
              </div>
              <h3 className="text-[16px] font-semibold">
                {connectedCount(statuses)} of {providers.length} tools connected
              </h3>
              <p className="max-w-md text-[13px] leading-5.5 text-ink-2">
                Your inbox refreshes every time the app opens, plus a daily auto-refresh at the time you
                pick in Settings (9:00 AM by default). You can re-run this guide anytime from Settings or
                the <span className="font-medium text-ink">⌘K</span> palette.
              </p>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={close}>
            Skip for now
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft size={14} />
                Back
              </Button>
            )}
            {mustConnect && (
              <Button variant="ghost" onClick={() => setStep((s) => s + 1)}>
                <SkipForward size={14} />
                Skip this connection
              </Button>
            )}
            {step < lastStep ? (
              <Button
                variant="primary"
                disabled={mustConnect}
                title={mustConnect ? `Connect ${provider?.name} to continue, or skip it` : undefined}
                onClick={() => setStep((s) => s + 1)}
              >
                {provider ? "Next" : "Get started"}
                <ArrowRight size={14} />
              </Button>
            ) : (
              <Button variant="primary" onClick={close}>
                Finish
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
