# Chutes Commit

**AI-powered commit messages using any model on [Chutes.ai](https://chutes.ai)**

> **Note:** This is an unofficial community extension. It is not built, maintained, or endorsed by Chutes.ai.

One click in the Source Control panel. Stage your changes, hit the sparkle button, and get a well-crafted [Conventional Commits](https://www.conventionalcommits.org/) message written for you.

---

## Why this exists

Writing good commit messages is important but tedious. Most AI commit tools lock you into a single provider or model. Chutes Commit uses **Chutes.ai** as a backend, giving you access to dozens of open-source and frontier models at low cost:

- **DeepSeek V3** -- fast, cheap, great at code
- **Qwen 2.5 Coder** -- purpose-built for code tasks
- **Qwen3 235B** -- strong reasoning
- **Llama 4 Maverick** -- Meta's latest
- ...and any other model available on Chutes.ai

You pick the model. You control the prompt. You own your workflow.

### Why Chutes.ai?

Chutes.ai provides an OpenAI-compatible API with access to a wide catalog of open models at competitive prices. No vendor lock-in, no proprietary models required -- just pick the model that works best for you and go.

---

## Features

- **One-click generation** -- sparkle button appears in the Source Control title bar
- **Conventional Commits** -- follows the spec out of the box (type, scope, description, body)
- **Regeneration** -- click again to get a completely different message
- **Live model browser** -- pick from all available Chutes.ai models via quick pick
- **Smart context** -- reads your branch, recent commits, staged diffs, and file changes
- **Lock file filtering** -- automatically skips package-lock.json, yarn.lock, and 15+ others
- **Binary detection** -- gracefully handles binary files in diffs
- **Diff truncation** -- large diffs are capped at 4000 chars per file to stay within token limits
- **Custom prompts** -- replace the system prompt entirely to match your team's commit style
- **Multi-repo support** -- works with multi-root workspaces, lets you pick which repo
- **Cancellable** -- progress spinner with cancel support in the SCM panel
- **Zero dependencies** -- uses Node built-ins only, no `node-fetch`, no `axios`, no SDKs

---

## Quick Start

1. **Install the extension** (see [Installation](#installation) below)
2. **Get a Chutes.ai API key** at [chutes.ai](https://chutes.ai) (keys start with `cpk_`)
3. **Set your API key**: `Ctrl+Shift+P` -> `Preferences: Open Settings` -> search `chutesCommit.apiKey`
4. **Stage some changes** with `git add`
5. **Click the sparkle button** in the Source Control panel title bar
6. **Review, edit if needed, commit**

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `chutesCommit.apiKey` | -- | Your Chutes.ai API key (`cpk_...`) |
| `chutesCommit.model` | `Qwen/Qwen2.5-Coder-32B-Instruct` | Model ID from Chutes.ai |
| `chutesCommit.temperature` | `0.3` | Generation temperature (0-2). Lower = more focused. |
| `chutesCommit.maxTokens` | `512` | Max response tokens (64-2048) |
| `chutesCommit.customPrompt` | -- | Full system prompt override. Replaces the default entirely. |

---

## Installation

### From source (local development)

```bash
git clone https://github.com/hithismani/chutes-commit.git
cd chutes-commit
npm install
npm run compile
```

Then in VS Code: `Ctrl+Shift+P` -> `Developer: Install Extension from Location...` -> select the folder.

### Package as .vsix

```bash
npm run package
code --install-extension chutes-commit-0.1.0.vsix
```

---

## How it works

```
Stage changes  ->  Click sparkle button  ->  Extension gathers git context
                                                  |
                                                  v
                                         Sends to Chutes.ai API
                                         (model of your choice)
                                                  |
                                                  v
                                         Cleans up LLM response
                                                  |
                                                  v
                                         Writes to commit input box
                                                  |
                                                  v
                                         You review and commit
```

**Context gathered per request:**
- Current branch name
- Last 5 commit messages (for style matching)
- Staged file list with statuses (added/modified/deleted/renamed)
- Per-file diffs (with lock files excluded, binaries detected, large diffs truncated)

**Regeneration:** If there's already text in the commit input box when you click the button, the extension tells the model to generate something completely different.

---

## Recommended models

| Model | Speed | Notes |
|---|---|---|
| `Qwen/Qwen2.5-Coder-32B-Instruct` | Fast | Default. Great balance of speed, cost, and quality. |
| `deepseek-ai/DeepSeek-V3` | Fast | Also excellent for code tasks. |
| `Qwen/Qwen3-235B-A22B` | Medium | Strong reasoning, good for complex changes. |
| `meta-llama/Llama-4-Maverick-17B-128E-Instruct` | Fast | Good alternative from Meta. |

Browse all available models at [chutes.ai](https://chutes.ai) or use `Ctrl+Shift+P` -> **Chutes Commit: Select Model** to pick one live.

---

## Custom prompts

Don't like Conventional Commits? Set `chutesCommit.customPrompt` to your own system prompt. The user message (with all the git context) stays the same -- only the system instructions change.

Example for a simpler style:
```
Write a short, imperative commit message (max 72 chars) summarizing the staged changes. No prefixes, no scopes, just a clear description. Return only the message, nothing else.
```

---

## Disclaimer

This is an unofficial, community-built extension. It is not affiliated with, endorsed by, or sponsored by Chutes.ai. All trademarks belong to their respective owners.

---

## License

MIT
