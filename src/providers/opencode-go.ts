import { createOpenAiCompatibleProvider } from "./factory";
import { Provider } from "./types";

export const opencodeGoProvider: Provider = createOpenAiCompatibleProvider({
  id: "opencode-go",
  label: "OpenCode Go",
  keyConfigKey: "opencodeZenKey",
  baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
  modelsUrl: "https://opencode.ai/zen/go/v1/models",
});
