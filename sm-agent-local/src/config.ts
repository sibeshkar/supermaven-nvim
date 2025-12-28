// Configuration for sm-agent-local
// For now, these are hardcoded. Later can be moved to env vars or config file.

export const CONFIG = {
  // Backend selection: "lmstudio" | "openrouter"
  backend: "lmstudio" as const,

  // LM Studio settings
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    model: "", // Empty = use loaded model
  },

  // OpenRouter settings
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: "mistralai/devstral-2512:free",
  },

  // Completion parameters
  maxTokens: 128,
  temperature: 0.2,

  // Context limits (characters)
  maxPrefixChars: 8000,
  maxSuffixChars: 2000,

  // Dust strings (comment patterns to filter)
  dustStrings: ["//", "#", "--", "/*", "*/", "*", "///", "<!--", "-->"],
};

// Helper to get the active backend config
export function getBackendConfig() {
  const base =
    CONFIG.backend === "lmstudio" ? CONFIG.lmstudio : CONFIG.openrouter;

  return {
    baseUrl: base.baseUrl,
    apiKey: "apiKey" in base ? (base.apiKey as string) : undefined,
    model: base.model,
    maxTokens: CONFIG.maxTokens,
    temperature: CONFIG.temperature,
  };
}
