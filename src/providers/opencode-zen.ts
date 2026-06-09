import { createOpenAiCompatibleProvider } from "./factory";
import { Provider } from "./types";

export const opencodeZenProvider: Provider = createOpenAiCompatibleProvider({
  id: "opencode-zen",
  label: "OpenCode Zen",
  keyConfigKey: "opencodeZenKey",
  baseUrl: "https://opencode.ai/zen/v1/chat/completions",
  modelsUrl: "https://opencode.ai/zen/v1/models",
});
