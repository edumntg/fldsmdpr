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
    tokenLabel: "Session token (no app needed)",
    placeholder: "",
    createUrl: "https://app.slack.com",
    createUrlLabel: "Open Slack in your browser",
    steps: [
      "Your org blocks creating Slack apps, so FLDSMDPR uses your existing browser session instead — no app, no admin approval.",
      "Open Slack in a browser (app.slack.com) and sign in. Open DevTools (⌥⌘I on Mac) → Console tab.",
      "Get your token: paste this and copy the xoxc-… result → Object.values(JSON.parse(localStorage.localConfig_v2).teams)[0].token",
      "Get your cookie: DevTools → Application → Cookies → app.slack.com → copy the value of the “d” cookie (starts with xoxd-).",
      "Paste both below and press Connect, then pick which channels FLDSMDPR should watch.",
    ],
    scopes: ["Read-only, session-scoped (same access your Slack already has)"],
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
    id: "sentry",
    name: "Sentry",
    tokenLabel: "User Auth Token",
    placeholder: "sntrys_… or sntryu_…",
    createUrl: "https://sentry.io/settings/account/api/auth-tokens/",
    createUrlLabel: "sentry.io → User Auth Tokens",
    steps: [
      "Open sentry.io → your avatar → User settings → “User Auth Tokens”.",
      "Create a new token named “FLDSMDPR” with the scopes listed below.",
      "Copy the token, paste it here, and press Connect — validated against the Sentry API, stored only in your OS keychain.",
      "Unresolved errors assigned to you then flow into the inbox with “Fix with agent”.",
    ],
    scopes: ["org:read", "project:read", "event:read"],
    available: true,
  },
  {
    id: "gcal",
    name: "Google Calendar",
    tokenLabel: "Secret iCal URL (no app / OAuth)",
    placeholder: "https://calendar.google.com/calendar/ical/…/basic.ics",
    createUrl: "https://calendar.google.com/calendar/r/settings",
    createUrlLabel: "Google Calendar settings",
    steps: [
      "Open Google Calendar → Settings → under “Settings for my calendars” pick the calendar you want.",
      "Scroll to “Integrate calendar” → copy the “Secret address in iCal format” (a private, read-only .ics URL).",
      "Paste it below and press Connect. FLDSMDPR fetches it directly — no OAuth, no app, read-only.",
      "Note: if your Workspace admin disabled the secret iCal address, this won't be available and we'd need the OAuth flow instead.",
    ],
    scopes: ["Read-only (private iCal link)"],
    available: true,
  },
];

export const providerMeta = (id: string) => PROVIDER_META.find((p) => p.id === id);
