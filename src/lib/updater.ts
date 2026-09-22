import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useToasts } from "../stores/toast";

/** On launch: check GitHub Releases, download silently, offer a restart. */
export async function checkForUpdate() {
  if (!import.meta.env.PROD) return; // dev builds never self-replace
  try {
    const update = await check();
    if (!update) return;
    await update.downloadAndInstall();
    useToasts.getState().push(
      {
        message: `FLDSMDPR ${update.version} is ready`,
        tone: "success",
        action: { label: "Restart now", run: () => void relaunch() },
      },
      10 * 60_000,
    );
  } catch (e) {
    console.warn("update check failed", e);
  }
}
