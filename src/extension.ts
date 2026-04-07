import * as vscode from "vscode";
import { gatherGitContext, assembleUserMessage } from "./git-context";
import { generateCommitMessage, fetchAvailableModels } from "./chutes-api";
import { DEFAULT_SYSTEM_PROMPT } from "./prompt";

interface GitExtensionAPI {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

async function getRepository(): Promise<GitRepository | undefined> {
  const gitExtension = vscode.extensions.getExtension<GitExtensionAPI>("vscode.git");
  if (!gitExtension) {
    vscode.window.showErrorMessage("Git extension not found.");
    return undefined;
  }

  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  const api = git.getAPI(1);

  if (api.repositories.length === 0) {
    vscode.window.showErrorMessage("No Git repositories found in workspace.");
    return undefined;
  }

  if (api.repositories.length === 1) {
    return api.repositories[0];
  }

  // Multiple repos — let user pick
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
      "Commit Pilot: API key not configured.",
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
  if (!repo) {
    return;
  }

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
          vscode.window.showErrorMessage(`Commit Pilot: ${message}`);
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
    vscode.window.showErrorMessage(`Commit Pilot: Failed to fetch models. ${message}`);
    return;
  }

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0] as { label: string; modelName?: string } | undefined;
    quickPick.dispose();
    if (selected?.modelName) {
      const config = vscode.workspace.getConfiguration("chutesCommit");
      await config.update("model", selected.modelName, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Commit Pilot: Model set to ${selected.modelName}`);
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
}

let statusBarItem: vscode.StatusBarItem;

function updateStatusBar(): void {
  const config = vscode.workspace.getConfiguration("chutesCommit");
  const model = config.get<string>("model", "Qwen/Qwen2.5-Coder-32B-Instruct");
  // Show just the model name part (after the org/)
  const shortName = model.includes("/") ? model.split("/").pop()! : model;
  statusBarItem.text = `$(sparkle) ${shortName}`;
  statusBarItem.tooltip = `Commit Pilot: ${model}\nClick to change model`;
}

export function activate(context: vscode.ExtensionContext): void {
  // Status bar item — shows current model, click to change
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = "chutes-commit.selectModel";
  updateStatusBar();
  statusBarItem.show();

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
    vscode.commands.registerCommand(
      "chutes-commit.openSettings",
      () => vscode.commands.executeCommand("workbench.action.openSettings", "chutesCommit")
    ),
    // Update status bar when settings change
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("chutesCommit.model")) {
        updateStatusBar();
      }
    })
  );
}

export function deactivate(): void {}
