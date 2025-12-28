// ============================================================================
// Incoming Messages (from plugin via stdin)
// ============================================================================

export interface GreetingMessage {
  kind: "greeting";
  allowGitignore: boolean;
}

export interface FileUpdate {
  kind: "file_update";
  path: string;
  content: string;
}

export interface CursorUpdate {
  kind: "cursor_update";
  path: string;
  offset: number;
}

export type StateUpdateItem = FileUpdate | CursorUpdate;

export interface StateUpdateMessage {
  kind: "state_update";
  newId: string;
  updates: StateUpdateItem[];
}

export interface InformFileChangedMessage {
  kind: "inform_file_changed";
  path: string;
}

export interface UseFreeVersionMessage {
  kind: "use_free_version";
}

export interface LogoutMessage {
  kind: "logout";
}

export type IncomingMessage =
  | GreetingMessage
  | StateUpdateMessage
  | InformFileChangedMessage
  | UseFreeVersionMessage
  | LogoutMessage;

// ============================================================================
// Outgoing Messages (to plugin via stdout, prefixed with "SM-MESSAGE ")
// ============================================================================

export interface TextResponseItem {
  kind: "text";
  text: string;
}

export interface EndResponseItem {
  kind: "end";
}

export type ResponseItem = TextResponseItem | EndResponseItem;

export interface ResponseMessage {
  kind: "response";
  stateId: string;
  items: ResponseItem[];
}

export interface ServiceTierMessage {
  kind: "service_tier";
  display: string;
}

export interface ActivationSuccessMessage {
  kind: "activation_success";
}

export interface MetadataMessage {
  kind: "metadata";
  dustStrings: string[];
}

export type OutgoingMessage =
  | ResponseMessage
  | ServiceTierMessage
  | ActivationSuccessMessage
  | MetadataMessage;

// ============================================================================
// Internal Types
// ============================================================================

export interface CompletionContext {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
}

export interface CompletionOptions {
  maxPrefixChars?: number;
  maxSuffixChars?: number;
}

export type FimFormat = "qwen" | "codellama" | null;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ============================================================================
// Backend Types
// ============================================================================

export interface BackendConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface CompletionBackend {
  complete(context: CompletionContext, signal?: AbortSignal): Promise<string>;
  streamComplete(
    context: CompletionContext,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown>;
}
