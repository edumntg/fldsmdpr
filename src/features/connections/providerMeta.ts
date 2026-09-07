import type { Source } from "../../lib/types";

export interface ProviderMeta {
  id: Source;
  name: string;
  tokenLabel: string;
  placeholder: string;
  createUrl: string;
  createUrlLabel: string;
  /** Step-by-step setup instructions shown in Connections & onboarding. */
  steps: string[];
  scopes: string[];
  available: boolean;
  unavailableNote?: string;
}

export const PROVIDER_META: ProviderMeta[] = [
  {
    id: "github",
    name: "GitHub",
    tokenLabel: "Personal Access Token",
    placeholder: "ghp_… or github_pat_…",
    createUrl: "https://github.com/settings/tokens",
    createUrlLabel: "github.com/settings/tokens",
    steps: [
      "Open GitHub → Settings → Developer settings → Personal access tokens.",
      "Choose “Fine-grained token” (recommended) or “Tokens (classic)”.",
      "Give it a name like “FLDSMDPR”, set an expiration, and select the organizations/repos you work in.",
      "Grant the scopes listed below, generate the token, and copy it.",
      "If your organization enforces SAML SSO: on the tokens page, click “Configure SSO” next to the token and authorize it for each org — without this, org items silently won't appear.",
      "Paste it here and press Connect — it is validated against the GitHub API and stored only in your OS keychain.",
    ],
    scopes: ["repo (or per-repo read access)", "notifications", "read:org"],
    available: true,
  },
  {
    id: "slack",
    name: "Slack",
    tokenLabel: "User OAuth Token",
    placeholder: "xoxp-…",
    createUrl: "https://api.slack.com/apps",
    createUrlLabel: "api.slack.com/apps",
    steps: [
      "Go to api.slack.com/apps → “Create New App” → “From scratch”, pick your workspace.",
      "In “OAuth & Permissions”, add the User Token Scopes listed below.",
      "Click “Install to Workspace” and authorize. Your workspace may require admin approval.",
      "Copy the “User OAuth Token” (starts with xoxp-).",
      "Paste it here and press Connect. FLDSMDPR only reads channels you opt into for AI triage.",
    ],
    scopes: ["channels:history", "channels:read", "groups:history", "im:history", "users:read", "search:read"],
    available: true,
  },
  {
    id: "linear",
    name: "Linear",
    tokenLabel: "Personal API Key",
    placeholder: "lin_api_…",
    createUrl: "https://linear.app/settings/account/security",
    createUrlLabel: "linear.app/settings → Security & access",
    steps: [
      "Open Linear → Settings → Security & access → “Personal API keys”.",
      "Click “New API key”, name it “FLDSMDPR”.",
      "Copy the key (shown once).",
      "Paste it here and press Connect — validated against the Linear GraphQL API.",
    ],
    scopes: ["Read access (issues, comments, cycles)"],
    available: true,
  },
  {
    id: "gcal",
    name: "Google Calendar",
    tokenLabel: "OAuth",
    placeholder: "",
    createUrl: "https://console.cloud.google.com/apis/credentials",
    createUrlLabel: "console.cloud.google.com",
    steps: [
      "Google Calendar connects through OAuth (browser sign-in), not a pasted key.",
      "The guided OAuth flow ships in Phase 3 — no setup needed yet.",
    ],
    scopes: ["calendar.readonly"],
    available: false,
    unavailableNote: "OAuth flow lands in Phase 3",
  },
];

export const providerMeta = (id: string) => PROVIDER_META.find((p) => p.id === id);
