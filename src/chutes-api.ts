import * as https from "https";

const API_URL = "https://llm.chutes.ai/v1/chat/completions";
const CLIENT_TIMEOUT_MS = 35_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

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

function request(
  apiKey: string,
  body: string,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request cancelled"));
      return;
    }

    const url = new URL(API_URL);

    const req = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: CLIENT_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode !== 200) {
            try {
              const parsed = JSON.parse(rawBody);
              const msg =
                parsed.error?.message ||
                parsed.detail ||
                `HTTP ${res.statusCode}`;
              reject(new Error(msg));
            } catch {
              reject(new Error(`HTTP ${res.statusCode}: ${rawBody.slice(0, 200)}`));
            }
            return;
          }

          try {
            const parsed: ChatCompletionResponse = JSON.parse(rawBody);
            const content = parsed.choices?.[0]?.message?.content;
            if (!content) {
              reject(new Error("Empty response from model"));
              return;
            }
            resolve(content);
          } catch {
            reject(new Error("Failed to parse API response"));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (signal) {
      const onAbort = () => {
        req.destroy();
        reject(new Error("Request cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    req.write(body);
    req.end();
  });
}

// --- Model listing ---

const MODELS_BASE_URL = "https://api.chutes.ai/chutes/";

export interface ChutesModel {
  name: string;
  tagline: string;
  hot: boolean;
  invocationCount: number;
}

function httpsGet(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        headers: { Accept: "application/json" },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve(body);
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

export async function fetchAvailableModels(): Promise<ChutesModel[]> {
  const allModels: ChutesModel[] = [];
  let page = 0;
  const limit = 200;

  // Paginate through all vLLM chutes
  while (true) {
    const url = `${MODELS_BASE_URL}?include_public=true&template=vllm&limit=${limit}&page=${page}`;
    const raw = await httpsGet(url, 15_000);
    const data = JSON.parse(raw);

    for (const item of data.items || []) {
      allModels.push({
        name: item.name,
        tagline: item.tagline || "",
        hot: !!item.hot,
        invocationCount: item.invocation_count || 0,
      });
    }

    // If we got fewer items than the limit, we've reached the end
    if (!data.items || data.items.length < limit) {
      break;
    }
    page++;
  }

  // Sort: hot models first, then by invocation count descending
  allModels.sort((a, b) => {
    if (a.hot !== b.hot) return a.hot ? -1 : 1;
    return b.invocationCount - a.invocationCount;
  });

  return allModels;
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
      const raw = await request(options.apiKey, body, options.signal);
      return cleanResponse(raw);
    } catch (err) {
      lastError = err as Error;

      // Don't retry on cancellation
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
