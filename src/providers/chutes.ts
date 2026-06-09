import { httpRequest } from "../http";
import { ChutesModel, Provider } from "./types";

const LLM_URL = "https://llm.chutes.ai/v1/chat/completions";
const MODELS_URL = "https://api.chutes.ai/chutes/";
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 10;

let cachedModels: ChutesModel[] | null = null;
let cacheTimestamp = 0;
let pendingFetch: Promise<ChutesModel[]> | null = null;

async function fetchModels(): Promise<ChutesModel[]> {
  if (cachedModels && Date.now() - cacheTimestamp < MODEL_CACHE_TTL_MS) {
    return cachedModels;
  }

  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = (async () => {
    try {
      const allModels: ChutesModel[] = [];
      let page = 0;
      const limit = 200;

      while (page < MAX_PAGES) {
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

      allModels.sort((a, b) => {
        if (a.hot !== b.hot) return a.hot ? -1 : 1;
        return b.invocationCount - a.invocationCount;
      });

      cachedModels = allModels;
      cacheTimestamp = Date.now();
      return allModels;
    } finally {
      pendingFetch = null;
    }
  })();

  return pendingFetch;
}

export const chutesProvider: Provider = {
  id: "chutes",
  label: "Chutes.ai",
  keyConfigKey: "chutesApiKey",
  baseUrl: LLM_URL,
  fetchModels,
};
