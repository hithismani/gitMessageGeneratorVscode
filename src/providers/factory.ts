import { httpRequest } from "../http";
import { ChutesModel, Provider } from "./types";

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

export function createOpenAiCompatibleProvider(options: {
  id: string;
  label: string;
  keyConfigKey: string;
  baseUrl: string;
  modelsUrl: string;
}): Provider {
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
        const raw = await httpRequest({ url: options.modelsUrl });
        const list = JSON.parse(raw);
        const items: unknown[] = Array.isArray(list)
          ? list
          : list.data || list.models || [];

        const models: ChutesModel[] = items.map((item: any) => ({
          name: item.id || item.name,
          tagline:
            (item.owned_by || "") +
            (item.description ? " - " + item.description : ""),
          hot: true,
          invocationCount: 0,
        }));

        cachedModels = models;
        cacheTimestamp = Date.now();
        return models;
      } finally {
        pendingFetch = null;
      }
    })();

    return pendingFetch;
  }

  return {
    id: options.id,
    label: options.label,
    keyConfigKey: options.keyConfigKey,
    baseUrl: options.baseUrl,
    fetchModels,
  };
}
