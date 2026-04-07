import { httpRequest } from "./http";

const LLM_URL = "https://llm.chutes.ai/v1/chat/completions";
const MODELS_URL = "https://api.chutes.ai/chutes/";
const CLIENT_TIMEOUT_MS = 35_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// --- Model cache (5 min TTL) ---

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

export interface ChutesModel {
  name: string;
  tagline: string;
  hot: boolean;
  invocationCount: number;
}

let cachedModels: ChutesModel[] | null = null;
let cacheTimestamp = 0;

export async function fetchAvailableModels(): Promise<ChutesModel[]> {
  if (cachedModels && Date.now() - cacheTimestamp < MODEL_CACHE_TTL_MS) {
    return cachedModels;
  }

  const allModels: ChutesModel[] = [];
  let page = 0;
  const limit = 200;

  while (true) {
    const url = `${MODELS_URL}?include_public=true&template=vllm&limit=${limit}&page=${page}`;
    const raw = await httpRequest({ url });
    const data = JSON.parse(raw);

    for (const item of data.items || []) {
      allModels.push({
        name: item.name,
        tagline: item.tagline || "",
        hot: !!item.hot,
        invocationCount: item.invocation_count || 0,
      });
    }

    if (!data.items || data.items.length < limit) {
      break;
    }
    page++;
  }

  // Hot models first, then by popularity
  allModels.sort((a, b) => {
    if (a.hot !== b.hot) return a.hot ? -1 : 1;
    return b.invocationCount - a.invocationCount;
  });

  cachedModels = allModels;
  cacheTimestamp = Date.now();
  return allModels;
}

// --- Commit message generation ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanResponse(text: string): string {
  let cleaned = text.trim();

  // Remove markdown code block wrappers
  const codeBlockMatch = cleaned.match(/^```(?:\w*)\n([\s\S]*?)\n```$/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Remove surrounding quotes
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
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
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

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (options.signal?.aborted) {
      throw new Error("Request cancelled");
    }

    try {
      const raw = await httpRequest({
        url: LLM_URL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body,
        timeoutMs: CLIENT_TIMEOUT_MS,
        signal: options.signal,
      });

      const parsed = JSON.parse(raw);
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

      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError!;
}
