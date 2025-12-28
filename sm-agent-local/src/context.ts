// Context extraction from state updates

import type { StateUpdateItem, CompletionContext, CompletionOptions } from "./types";
import { CONFIG } from "./config";

// Map of file extensions to language names
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JavaScript/TypeScript
  ".js": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mjs": "javascript",
  ".cjs": "javascript",

  // Python
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",

  // Systems languages
  ".rs": "rust",
  ".go": "go",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",

  // JVM languages
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",

  // Web
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",

  // Config/Data
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",

  // Shell
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".fish": "fish",

  // Other
  ".lua": "lua",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".r": "r",
  ".R": "r",
  ".sql": "sql",
  ".md": "markdown",
  ".markdown": "markdown",
  ".vim": "vim",
  ".el": "elisp",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".fs": "fsharp",
  ".cs": "csharp",
  ".vb": "vb",
  ".pl": "perl",
  ".pm": "perl",
};

/**
 * Detect programming language from file path.
 */
export function detectLanguage(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return "text";

  const ext = filePath.slice(lastDot).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] ?? "text";
}

/**
 * Extract completion context from state update items.
 * Returns prefix (text before cursor), suffix (text after cursor),
 * detected language, and file path.
 */
export function extractContext(
  updates: StateUpdateItem[],
  options?: CompletionOptions
): CompletionContext {
  const maxPrefixChars = options?.maxPrefixChars ?? CONFIG.maxPrefixChars;
  const maxSuffixChars = options?.maxSuffixChars ?? CONFIG.maxSuffixChars;

  let filePath = "";
  let fileContent = "";
  let cursorOffset = 0;

  // Extract file content and cursor position from updates
  for (const update of updates) {
    if (update.kind === "file_update") {
      filePath = update.path;
      fileContent = update.content;
    } else if (update.kind === "cursor_update") {
      // Use cursor path if no file update yet
      if (!filePath) {
        filePath = update.path;
      }
      cursorOffset = update.offset;
    }
  }

  // Ensure cursor offset is within bounds
  cursorOffset = Math.max(0, Math.min(cursorOffset, fileContent.length));

  // Split content at cursor position
  let prefix = fileContent.slice(0, cursorOffset);
  let suffix = fileContent.slice(cursorOffset);

  // Truncate to limits
  if (prefix.length > maxPrefixChars) {
    // Keep the end of the prefix (most relevant)
    prefix = prefix.slice(-maxPrefixChars);
  }
  if (suffix.length > maxSuffixChars) {
    // Keep the start of the suffix (most relevant)
    suffix = suffix.slice(0, maxSuffixChars);
  }

  const language = detectLanguage(filePath);

  return {
    prefix,
    suffix,
    language,
    filePath,
  };
}
