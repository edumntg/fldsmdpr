import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { kvGet, kvSet, secretGet, secretSet } from "../../lib/ipc";
import { Button } from "../../components/ui/Button";

const INPUT =
  "h-8.5 flex-1 rounded-xl border border-line bg-surface px-3 font-mono text-xs text-ink outline-none placeholder:text-ink-3 focus:border-accent";

/** OpenRouter key (keychain) + the model id Jev runs as. */
export function UrgentSettings() {
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void secretGet("openrouter_api_key").then((k) => setHasKey(!!k));
    void kvGet("jev_model").then((m) => m && setModel(m));
  }, []);

  const save = async () => {
    if (key.trim()) {
      await secretSet("openrouter_api_key", key.trim());
      setHasKey(true);
      setKey("");
    }
    await kvSet("jev_model", model.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <p className="text-xs text-ink-3">
        The Today view sends your newest inbox items to this model and shows the three it says to attack
        first. The key lives only in your OS keychain.
      </p>
      <label className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs font-medium text-ink-2">API key</span>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasKey ? "•••••••• saved — paste to replace" : "sk-or-v1-…"}
          className={INPUT}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-xs font-medium text-ink-2">Model id</span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Jev's OpenRouter id · default anthropic/claude-sonnet-4.5"
          className={INPUT}
        />
      </label>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => void save()}>
          {saved ? <Check size={13} /> : null}
          {saved ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );
}
