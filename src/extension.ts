import * as vscode from "vscode";
import { gatherGitContext, assembleUserMessage } from "./git-context";
import { generateCommitMessage } from "./llm";
import { getPromptForStyle, BUILTIN_STYLES } from "./prompt";
import { chutesProvider } from "./providers/chutes";
import { opencodeZenProvider } from "./providers/opencode-zen";
import { opencodeGoProvider } from "./providers/opencode-go";
import { Provider } from "./providers/types";

const CONFIG_PREFIX = "gitMessageGenerator";
const OLD_CONFIG_PREFIX = "chutesCommit";

const PROVIDERS: Record<string, Provider> = {
  chutes: chutesProvider,
  "opencode-zen": opencodeZenProvider,
  "opencode-go": opencodeGoProvider,
};

function getProvider(id: string | undefined): Provider {
  return PROVIDERS[id || ""] || chutesProvider;
}

interface GitExtensionAPI {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

let gitApi: GitAPI | undefined;
let statusBarItem: vscode.StatusBarItem;
let gitApiDisposables: vscode.Disposable[] = [];
let extensionContext: vscode.ExtensionContext;

// --- Secret storage for API keys ---

async function getApiKey(keyName: string): Promise<string> {
  const stored = await extensionContext.secrets.get(keyName);
  if (stored) return stored;

  // fallback: migrate from old plaintext config
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
  const fromConfig = config.get<string>(keyName, "");
  if (fromConfig) {
    await extensionContext.secrets.store(keyName, fromConfig);
    await config.update(keyName, undefined, vscode.ConfigurationTarget.Global);
    return fromConfig;
  }

  return "";
}

async function setApiKey(keyName: string, value: string): Promise<void> {
  await extensionContext.secrets.store(keyName, value);
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
  await config.update(keyName, undefined, vscode.ConfigurationTarget.Global);
}

// --- Git API ---

async function getGitApi(): Promise<GitAPI | undefined> {
  if (gitApi) return gitApi;
  const ext = vscode.extensions.getExtension<GitExtensionAPI>("vscode.git");
  if (!ext) return undefined;
  const git = ext.isActive ? ext.exports : await ext.activate();
  gitApi = git.getAPI(1);
  return gitApi;
}

async function getRepository(): Promise<GitRepository | undefined> {
  const api = await getGitApi();
  if (!api) {
    vscode.window.showErrorMessage("Git extension not found.");
    return undefined;
  }

  if (api.repositories.length === 0) {
    vscode.window.showErrorMessage("No Git repositories found in workspace.");
    return undefined;
  }

  if (api.repositories.length === 1) {
    return api.repositories[0];
  }

  const items = api.repositories.map((repo) => ({
    label: repo.rootUri.fsPath,
    repo,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a repository",
  });

  return picked?.repo;
}

function getProviderKey(config: vscode.WorkspaceConfiguration): string {
  return config.get<string>("provider", "chutes");
}

// --- Set API key command ---

async function handleSetApiKey(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
  const provider = getProvider(getProviderKey(config));

  const value = await vscode.window.showInputBox({
    prompt: `Enter API key for ${provider.label}`,
    placeHolder:
      provider.id === "chutes" ? "cpk_..." : "opencode zen/go key...",
    password: true,
    ignoreFocusOut: true,
  });

  if (value) {
    await setApiKey(provider.keyConfigKey, value);
    vscode.window.showInformationMessage(
      `gitMessageGenerator: API key saved for ${provider.label}`
    );
  }
}

// --- Generate commit message ---

async function handleGenerateCommitMessage(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
  const provider = getProvider(getProviderKey(config));
  const apiKey = await getApiKey(provider.keyConfigKey);

  if (!apiKey) {
    const action = await vscode.window.showErrorMessage(
      `gitMessageGenerator: ${provider.label} API key not configured.`,
      "Set API Key"
    );
    if (action === "Set API Key") {
      handleSetApiKey();
    }
    return;
  }

  const repo = await getRepository();
  if (!repo) return;

  const previousMessage = repo.inputBox.value.trim() || undefined;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: "Generating commit message...",
      cancellable: true,
    },
    async (_progress, token) => {
      const abortController = new AbortController();
      token.onCancellationRequested(() => abortController.abort());

      let model = config.get<string>("model", "");
      const temperature = config.get<number>("temperature", 0.3);
      const maxTokens = config.get<number>("maxTokens", 512);
      const customPrompt = config.get<string>("customPrompt", "");
      const commitStyle = config.get<string>("commitStyle", "conventional");
      const customStyles = config.get<Record<string, string>>(
        "customStyles",
        {}
      );
      const systemPrompt =
        customPrompt || getPromptForStyle(commitStyle, customStyles);
      let userMessage = "";

      if (!model) {
        vscode.window.showErrorMessage(
          'gitMessageGenerator: No model selected. Run "Select Model" to pick one.'
        );
        return;
      }

      const doGenerate = async (m: string) =>
        generateCommitMessage({
          apiKey,
          baseUrl: provider.baseUrl,
          model: m,
          systemPrompt,
          userMessage,
          temperature,
          maxTokens,
          signal: abortController.signal,
          maxRetries: config.get<number>("maxRetries", 2),
          retryDelayMs: config.get<number>("retryDelayMs", 1000),
        });

      try {
        const context = await gatherGitContext(
          repo.rootUri.fsPath,
          config.get<number>("maxDiffLength", 4000),
          config.get<number>("recentCommitCount", 5),
          config.get<string[]>("lockFiles", [])
        );
        userMessage = assembleUserMessage(context, previousMessage);

        const commitMessage = await doGenerate(model);
        repo.inputBox.value = commitMessage;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "Request cancelled") return;

        const autoFallback = config.get<boolean>("autoFallback", true);
        const isModelMissing =
          /not found|does not exist|not exist/i.test(message);

        if (autoFallback && isModelMissing) {
          const models = await provider.fetchModels();
          const fallback = models.find((m) => m.hot);
          if (fallback && fallback.name !== model) {
            const oldModel = model;
            model = fallback.name;
            await config.update(
              "model",
              model,
              vscode.ConfigurationTarget.Global
            );

            try {
              const commitMessage = await doGenerate(model);
              repo.inputBox.value = commitMessage;
              vscode.window.showInformationMessage(
                `gitMessageGenerator: "${oldModel}" not found — switched to ${model}`
              );
              return;
            } catch (fallbackErr) {
              vscode.window.showErrorMessage(
                `gitMessageGenerator: Fallback to "${model}" also failed. ${
                  fallbackErr instanceof Error
                    ? fallbackErr.message
                    : String(fallbackErr)
                }`
              );
              return;
            }
          }
        }

        vscode.window.showErrorMessage(
          `gitMessageGenerator (${provider.label} / ${model}): ${message}`
        );
      }
    }
  );
}

// --- Select model ---

async function handleSelectModel(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);

  const providerKeys = Object.entries(PROVIDERS).map(([key, p]) => ({
    providerKey: key,
    provider: p,
  }));

  let currentKey = getProviderKey(config);
  let provider = getProvider(currentKey);

  const quickPick = vscode.window.createQuickPick();
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  const providerButtons = providerKeys.map(({ providerKey, provider: p }) => ({
    iconPath: new vscode.ThemeIcon("server"),
    tooltip: `Switch to ${p.label}`,
    providerKey,
  }));
  quickPick.buttons = [
    ...providerButtons,
    {
      iconPath: new vscode.ThemeIcon("key"),
      tooltip: `API key: ${provider.keyConfigKey}${
        provider.keyConfigKey === "opencodeZenKey"
          ? " (shared by Zen & Go)"
          : ""
      }`,
      providerKey: "",
    },
  ];

  async function loadModels() {
    quickPick.busy = true;
    quickPick.placeholder = `Search ${provider.label} models...`;
    quickPick.title = `${provider.label} — ${provider.keyConfigKey}${
      provider.keyConfigKey === "opencodeZenKey" ? " (shared)" : ""
    }`;

    const allItems: vscode.QuickPickItem[] = [];
    const modelMap = new Map<string, string>();

    try {
      const models = await provider.fetchModels();
      for (const m of models) {
        const label = `${m.hot ? "$(circle-filled) " : ""}${m.name}`;
        modelMap.set(label, m.name);
        allItems.push({
          label,
          description: m.hot ? "active" : "",
          detail: m.tagline,
        });
      }
      quickPick.items = allItems;
    } catch (err) {
      quickPick.items = [];
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        `gitMessageGenerator: Failed to fetch models from ${provider.label}. ${message}`
      );
    } finally {
      quickPick.busy = false;
    }

    return { allItems, modelMap };
  }

  let { allItems, modelMap } = await loadModels();
  quickPick.show();

  quickPick.onDidChangeValue((value) => {
    if (!value) {
      quickPick.items = allItems;
      return;
    }
    const q = value.toLowerCase();
    quickPick.items = allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.detail?.toLowerCase().includes(q)
    );
  });

  quickPick.onDidTriggerButton(async (btn) => {
    const { providerKey } = btn as { providerKey?: string };
    if (!providerKey) return;
    currentKey = providerKey;
    provider = getProvider(currentKey);
    await config.update(
      "provider",
      currentKey,
      vscode.ConfigurationTarget.Global
    );
    ({ allItems, modelMap } = await loadModels());
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    quickPick.dispose();
    const modelName = selected ? modelMap.get(selected.label) : undefined;
    if (modelName) {
      await config.update(
        "model",
        modelName,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage(
        `gitMessageGenerator: Model set to ${modelName}`
      );
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
}

// --- Select style ---

async function handleSelectStyle(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
  const currentStyle = config.get<string>("commitStyle", "conventional");
  const customStyles = config.get<Record<string, string>>("customStyles", {});

  const items: (vscode.QuickPickItem & { styleName: string })[] = [];

  for (const [name] of Object.entries(BUILTIN_STYLES)) {
    items.push({
      label: name,
      description: name === currentStyle ? "current" : "",
      detail:
        name === "conventional"
          ? "feat(scope): description"
          : "add user auth endpoint",
      styleName: name,
    });
  }

  for (const [name] of Object.entries(customStyles)) {
    items.push({
      label: name,
      description: name === currentStyle ? "current" : "custom",
      detail: "user-defined style",
      styleName: name,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select commit message style",
  });

  if (picked) {
    await config.update(
      "commitStyle",
      picked.styleName,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage(
      `gitMessageGenerator: Commit style set to "${picked.styleName}"`
    );
  }
}

// --- Status bar ---

function updateStatusBar(): void {
  const config = vscode.workspace.getConfiguration(CONFIG_PREFIX);
  const provider = getProvider(getProviderKey(config));
  const model = config.get<string>("model", "");
  const shortName = model
    ? model.includes("/")
      ? model.split("/").pop()!
      : model
    : "pick model";
  statusBarItem.text = `$(sparkle) ${shortName}`;
  statusBarItem.tooltip = `gitMessageGenerator: ${
    model || "no model selected"
  }\nProvider: ${provider.label}\nClick to change model`;
}

function updateStatusBarVisibility(): void {
  const hasRepos = gitApi && gitApi.repositories.length > 0;
  if (hasRepos) {
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

async function setupGitListeners(): Promise<void> {
  const api = await getGitApi();
  if (api) {
    updateStatusBarVisibility();
    gitApiDisposables.push(
      api.onDidOpenRepository(() => updateStatusBarVisibility()),
      api.onDidCloseRepository(() => updateStatusBarVisibility())
    );
  }
}

// --- Settings migration ---

async function migrateSettings(): Promise<void> {
  try {
    const oldConfig = vscode.workspace.getConfiguration(OLD_CONFIG_PREFIX);
    const newConfig = vscode.workspace.getConfiguration(CONFIG_PREFIX);

    const oldKey = oldConfig.get<string>("apiKey", "");
    const oldModel = oldConfig.get<string>("model", "");

    const newModel = newConfig.get<string>("model", "");
    const newProvider = newConfig.get<string>("provider", "");

    let migrated = false;

    if (oldKey) {
      await extensionContext.secrets.store("chutesApiKey", oldKey);
      await oldConfig.update("apiKey", undefined, vscode.ConfigurationTarget.Global);
      migrated = true;
    }

    if (!newModel && oldModel) {
      await newConfig.update("model", oldModel, vscode.ConfigurationTarget.Global);
      migrated = true;
    }

    if (!newProvider && oldKey) {
      await newConfig.update("provider", "chutes", vscode.ConfigurationTarget.Global);
      migrated = true;
    }

    if (migrated) {
      vscode.window.showInformationMessage(
        "gitMessageGenerator: Migrated settings from previous version."
      );
    }
  } catch {
    // migration is best-effort
  }
}

// --- Activation ---

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  migrateSettings().catch(() => {});

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "gitmessagegenerator.selectModel";
  updateStatusBar();

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand(
      "gitmessagegenerator.generateCommitMessage",
      handleGenerateCommitMessage
    ),
    vscode.commands.registerCommand(
      "gitmessagegenerator.selectModel",
      handleSelectModel
    ),
    vscode.commands.registerCommand(
      "gitmessagegenerator.selectStyle",
      handleSelectStyle
    ),
    vscode.commands.registerCommand(
      "gitmessagegenerator.setApiKey",
      handleSetApiKey
    ),
    vscode.commands.registerCommand("gitmessagegenerator.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        CONFIG_PREFIX
      )
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(`${CONFIG_PREFIX}.model`) ||
        e.affectsConfiguration(`${CONFIG_PREFIX}.provider`)
      ) {
        updateStatusBar();
      }
    })
  );

  setupGitListeners().catch(() => {});
}

export function deactivate(): void {
  statusBarItem?.dispose();
  for (const d of gitApiDisposables) {
    d.dispose();
  }
  gitApiDisposables = [];
}
