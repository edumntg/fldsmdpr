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
  /** Plain-language consent gate, shown before a sign-in that grants access. */
  consent?: { will: string[]; wont: string[]; undo: string };
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
    tokenLabel: "Sign in to Slack (no app needed)",
    placeholder: "",
    createUrl: "https://slack.com/intl/en-gb/help/articles/214613947-Sign-out-of-Slack",
    createUrlLabel: "How to sign out of Slack sessions",
    steps: [
      "Your org blocks creating Slack apps, so FLDSMDPR signs in as you instead — no app, no admin approval.",
      "Press “Sign in to Slack”. A FLDSMDPR window opens on the normal Slack login page.",
      "Log in the way you always do — SSO, password, magic link. FLDSMDPR never sees your password.",
      "The window closes by itself once you are in. Then pick which channels FLDSMDPR should watch.",
    ],
    /** Shown as an explicit consent gate before the sign-in window opens. */
    consent: {
      will: [
        "Read messages in the channels you pick below, plus your direct messages.",
        "Store them in a SQLite file on this Mac, and your Slack session in the macOS keychain.",
        "Act read-only: it never posts, replies, reacts, or changes anything in Slack.",
      ],
      wont: [
        "It never sees your password — you type that into Slack's own login page.",
        "Nothing is uploaded anywhere. Claude summaries stay off until you switch them on.",
        "It reads nothing from the Slack desktop app or from your browsers.",
      ],
      undo: "Press Disconnect here to wipe the session from your keychain. To kill it on Slack's side too, sign out of all sessions from your Slack account page.",
    },
    scopes: ["Read-only, session-scoped (the same access your own Slack login has)"],
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
    tokenLabel: "User Auth Token (personal, not an org token)",
    placeholder: "sntryu_…",
    createUrl: "https://sentry.io/settings/account/api/auth-tokens/",
    createUrlLabel: "sentry.io → User Auth Tokens",
    steps: [
      "Open sentry.io → your avatar → User settings → “User Auth Tokens” (NOT Organization Settings — org tokens starting sntrys_ are for CI and won't work here).",
      "Create a new token named “FLDSMDPR” with the scopes listed below.",
      "Copy the token, paste it here, and press Connect — validated against the Sentry API, stored only in your OS keychain.",
      "It sees every org you're a member of; unresolved errors assigned to you then flow into the inbox and the Errors section with “Fix with agent”.",
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
