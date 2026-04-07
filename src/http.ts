import * as https from "https";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpRequestOptions {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function httpRequest(options: HttpRequestOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("Request cancelled"));
      return;
    }

    const parsed = new URL(options.url);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...options.headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode !== 200) {
            try {
              const parsed = JSON.parse(body);
              const msg =
                parsed.error?.message ||
                parsed.detail ||
                `HTTP ${res.statusCode}`;
              reject(new Error(msg));
            } catch {
              reject(
                new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)
              );
            }
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

    if (options.signal) {
      const onAbort = () => {
        req.destroy();
        reject(new Error("Request cancelled"));
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () =>
        options.signal!.removeEventListener("abort", onAbort)
      );
    }

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
