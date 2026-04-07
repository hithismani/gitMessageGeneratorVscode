import * as vscode from "vscode";
import { gatherGitContext, assembleUserMessage } from "./git-context";
import { generateCommitMessage, fetchAvailableModels } from "./chutes-api";
import { DEFAULT_SYSTEM_PROMPT } from "./prompt";

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

async function handleGenerateCommitMessage(): Promise<void> {
  const config = vscode.workspace.getConfiguration("chutesCommit");
  const apiKey = config.get<string>("apiKey", "");

  if (!apiKey) {
    const action = await vscode.window.showErrorMessage(
      "Chutes Commit: API key not configured.",
      "Open Settings"
    );
    if (action === "Open Settings") {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "chutesCommit.apiKey"
      );
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

      try {
        const context = await gatherGitContext(repo.rootUri.fsPath);
        const userMessage = assembleUserMessage(context, previousMessage);

        const model = config.get<string>("model", "Qwen/Qwen2.5-Coder-32B-Instruct");
        const temperature = config.get<number>("temperature", 0.3);
        const maxTokens = config.get<number>("maxTokens", 512);
        const customPrompt = config.get<string>("customPrompt", "");
        const systemPrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;

        const commitMessage = await generateCommitMessage({
          apiKey,
          model,
          systemPrompt,
          userMessage,
          temperature,
          maxTokens,
          signal: abortController.signal,
        });

        repo.inputBox.value = commitMessage;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== "Request cancelled") {
          vscode.window.showErrorMessage(`Chutes Commit: ${message}`);
        }
      }
    }
  );
}

async function handleSelectModel(): Promise<void> {
  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = "Search for a model...";
  quickPick.busy = true;
  quickPick.show();

  try {
    const models = await fetchAvailableModels();
    quickPick.busy = false;
    quickPick.items = models.map((m) => ({
      label: `${m.hot ? "$(circle-filled) " : ""}${m.name}`,
      description: m.hot ? "active" : "inactive",
      detail: m.tagline,
      modelName: m.name,
    }));
  } catch (err) {
    quickPick.dispose();
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `Chutes Commit: Failed to fetch models. ${message}`
    );
    return;
  }

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0] as
      | { label: string; modelName?: string }
      | undefined;
    quickPick.dispose();
    if (selected?.modelName) {
      const config = vscode.workspace.getConfiguration("chutesCommit");
      await config.update(
        "model",
        selected.modelName,
        vscode.ConfigurationTarget.Global
      );
      vscode.window.showInformationMessage(
        `Chutes Commit: Model set to ${selected.modelName}`
      );
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
}

// --- Status bar ---

function updateStatusBar(): void {
  const config = vscode.workspace.getConfiguration("chutesCommit");
  const model = config.get<string>("model", "Qwen/Qwen2.5-Coder-32B-Instruct");
  const shortName = model.includes("/") ? model.split("/").pop()! : model;
  statusBarItem.text = `$(sparkle) ${shortName}`;
  statusBarItem.tooltip = `Chutes Commit: ${model}\nClick to change model`;
}

function updateStatusBarVisibility(): void {
  const hasRepos = gitApi && gitApi.repositories.length > 0;
  if (hasRepos) {
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

// --- Activation ---

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "chutes-commit.selectModel";
  updateStatusBar();

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand(
      "chutes-commit.generateCommitMessage",
      handleGenerateCommitMessage
    ),
    vscode.commands.registerCommand(
      "chutes-commit.selectModel",
      handleSelectModel
    ),
    vscode.commands.registerCommand("chutes-commit.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "chutesCommit"
      )
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("chutesCommit.model")) {
        updateStatusBar();
      }
    })
  );

  // Show status bar only when git repos are present
  getGitApi().then((api) => {
    if (api) {
      updateStatusBarVisibility();
      context.subscriptions.push(
        api.onDidOpenRepository(() => updateStatusBarVisibility()),
        api.onDidCloseRepository(() => updateStatusBarVisibility())
      );
    }
  });
}

export function deactivate(): void {}
