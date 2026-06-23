import { httpRequest } from "./http";

const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(message: string): boolean {
  const fatal = /unauthorized|invalid.*key|forbidden|not found|does not exist/i;
  return !fatal.test(message);
}

function cleanResponse(text: string): string {
  let cleaned = text.trim();

  // Strip reasoning blocks emitted by reasoning models (DeepSeek-R1, QwQ, etc.)
  // These appear inline in the content field as <think>...</think>.
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Handle an unclosed opening tag (model never closed it): drop the rest.
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  // Remove any leftover stray tags.
  cleaned = cleaned.replace(/<\/?think>/gi, "");

  cleaned = cleaned.trim();

  const fence = cleaned.match(/```(?:\w*)\n?([\s\S]*?)```/);
  if (fence) {
    cleaned = fence[1].trim();
  }

  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  return cleaned;
}

export async function generateCommitMessage(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?: (message: string) => void;
}): Promise<string> {
  const body = JSON.stringify({
    model: options.model,
    messages: [
      { role: "system", content: options.systemPrompt },
      { role: "user", content: options.userMessage },
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new Error("Request cancelled");
    }

    if (attempt > 0) {
      options.onProgress?.(
        `Retry attempt ${attempt}/${maxRetries} — waiting for response...`
      );
    } else {
      options.onProgress?.("Waiting for response...");
    }

    try {
      const raw = await httpRequest({
        url: options.baseUrl,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body,
        timeoutMs,
        signal: options.signal,
      });

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("Invalid JSON response from API");
      }

      const content = parsed.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from model");
      }

      return cleanResponse(content);
    } catch (err) {
      lastError = err as Error;

      if (lastError.message === "Request cancelled") {
        throw lastError;
      }

      if (!isRetryable(lastError.message) || attempt >= maxRetries) {
        break;
      }

      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError!;
}
