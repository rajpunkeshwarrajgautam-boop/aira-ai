import type { ResearchMode } from "@/src/v2/compat/aira-api";

export type ResearchPresetId = "general" | "academic" | "startup" | "coding" | "shopping";

export interface ResearchPresetSummary {
  readonly id: ResearchPresetId;
  readonly label: string;
  readonly description: string;
  readonly preferredDepth: ResearchMode;
}

export const V2_RESEARCH_PRESETS: readonly ResearchPresetSummary[] = [
  {
    id: "general",
    label: "General",
    description: "Balanced research for everyday questions.",
    preferredDepth: "standard",
  },
  {
    id: "academic",
    label: "Academic",
    description: "Formal research with stronger methodology and citation discipline.",
    preferredDepth: "deep",
  },
  {
    id: "startup",
    label: "Startup",
    description: "Markets, business models, risks, and strategic opportunities.",
    preferredDepth: "standard",
  },
  {
    id: "coding",
    label: "Coding",
    description: "Technical accuracy, implementation detail, and code-oriented explanations.",
    preferredDepth: "standard",
  },
  {
    id: "shopping",
    label: "Shopping",
    description: "Comparison-focused research with tradeoffs and buyer recommendations.",
    preferredDepth: "standard",
  },
] as const;

export interface V2WorkspacePreferences {
  readonly defaultMode: ResearchMode;
  readonly defaultPreset: ResearchPresetId;
  readonly contextPanelOpen: boolean;
  readonly reduceMotion: boolean;
}

export const DEFAULT_V2_PREFERENCES: V2WorkspacePreferences = {
  defaultMode: "standard",
  defaultPreset: "general",
  contextPanelOpen: true,
  reduceMotion: false,
};

const STORAGE_KEY = "aira.v2.workspace.preferences.v1";

function isPreset(value: unknown): value is ResearchPresetId {
  return V2_RESEARCH_PRESETS.some((preset) => preset.id === value);
}

export function loadV2WorkspacePreferences(): V2WorkspacePreferences {
  if (typeof window === "undefined") return DEFAULT_V2_PREFERENCES;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<V2WorkspacePreferences>
      | null;
    if (!parsed) return DEFAULT_V2_PREFERENCES;
    return {
      defaultMode: parsed.defaultMode === "deep" ? "deep" : "standard",
      defaultPreset: isPreset(parsed.defaultPreset) ? parsed.defaultPreset : "general",
      contextPanelOpen:
        typeof parsed.contextPanelOpen === "boolean"
          ? parsed.contextPanelOpen
          : DEFAULT_V2_PREFERENCES.contextPanelOpen,
      reduceMotion:
        typeof parsed.reduceMotion === "boolean"
          ? parsed.reduceMotion
          : DEFAULT_V2_PREFERENCES.reduceMotion,
    };
  } catch {
    return DEFAULT_V2_PREFERENCES;
  }
}

export function saveV2WorkspacePreferences(preferences: V2WorkspacePreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are a progressive enhancement; storage failure must not block AIRA.
  }
}

export function researchPreset(id: ResearchPresetId): ResearchPresetSummary {
  return V2_RESEARCH_PRESETS.find((preset) => preset.id === id) ?? V2_RESEARCH_PRESETS[0];
}
