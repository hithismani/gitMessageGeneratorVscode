import * as https from "https";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpRequestOptions {
  url: string;
  method?: string;
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

    let settled = false;

    const done = (err: Error | null, body?: string) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(body!);
    };

    const headers: Record<string, string> = { ...options.headers };
    if (!("Accept" in headers)) {
      headers["Accept"] = "application/json";
    }

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode !== 200) {
            try {
              const parsedErr = JSON.parse(body);
              const msg =
                parsedErr.error?.message ||
                String(parsedErr.detail ?? "") ||
                `HTTP ${res.statusCode ?? "unknown"}`;
              done(new Error(msg));
            } catch {
              done(
                new Error(
                  `HTTP ${res.statusCode ?? "unknown"}: ${body.slice(0, 200)}`
                )
              );
            }
            return;
          }

          done(null, body);
        });
      }
    );

    req.on("error", (err) => done(err));
    req.on("timeout", () => {
      req.destroy();
      done(new Error("Request timed out"));
    });

    if (options.signal) {
      const onAbort = () => {
        req.destroy();
        done(new Error("Request cancelled"));
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () =>
        options.signal?.removeEventListener("abort", onAbort)
      );
    }

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
