# gitMessageGenerator

**AI-powered git commit messages via Chutes.ai, OpenCode Zen, or OpenCode Go — one click in Source Control.**

> **Requires an API key.** This extension does not provide free access — you must bring your own key from one of the supported providers.

Stage your changes, hit the sparkle button, get a well-crafted commit message. Supports [Conventional Commits](https://www.conventionalcommits.org/), imperative style, or your own custom format.

---

## Providers

Pick one via `gitMessageGenerator.provider`. Change anytime.

| Provider | Description | Key Setting |
|---|---|---|
| **Chutes.ai** | Community-hosted open models — Qwen, DeepSeek, GLM, Kimi, Llama | `gitMessageGenerator.chutesApiKey` |
| **OpenCode Zen** | Curated models from the OpenCode team — GPT, Claude, Gemini, Qwen, DeepSeek, 46 models | `gitMessageGenerator.opencodeZenKey` |
| **OpenCode Go** | Low-cost subscription tier — open-source coding models, 18 models | `gitMessageGenerator.opencodeZenKey` |

> All three use `Bearer` auth. Zen and Go share the same API key.

---

## Quick Start

1. **Install the extension** (see [Installation](#installation))
2. **Pick a provider** in settings: `chutes`, `opencode-zen`, or `opencode-go`
3. **Set your API key** in settings:
   - Chutes: `gitMessageGenerator.chutesApiKey` (keys start with `cpk_`)
   - OpenCode: `gitMessageGenerator.opencodeZenKey` (get one at [opencode.ai/auth](https://opencode.ai/auth))
4. **Pick a model** — required: `Ctrl+Shift+P` → `gitMessageGenerator: Select Model` → search and select
5. **Stage changes** with `git add`
6. **Click the sparkle** in the Source Control panel title bar

---

## Features

- **Three providers** — Chutes.ai, OpenCode Zen, OpenCode Go — switch anytime
- **Live model browser** — searchable quick pick, per-provider model lists fetched in real-time
- **Auto-fallback** — if your model is unavailable, picks the next active one (configurable)
- **Commit style selector** — built-in Conventional Commits and imperative, or define unlimited custom styles
- **Custom styles** — named presets at global or workspace level for per-project defaults
- **Settings auto-migration** — copies legacy settings to new prefix on first activation
- **Smart context** — branch name, recent commits, staged diffs with file statuses
- **Lock file filtering** — skips `package-lock.json`, `yarn.lock`, and 15+ others
- **Binary detection** — handles binary files in diffs gracefully
- **Regeneration** — click again while text is in the input box for a new message
- **Multi-repo support** — prompts you to pick a repo in multi-root workspaces
- **Cancellable progress** — cancel anytime from the SCM panel
- **Zero dependencies** — uses Node.js built-ins only

---

## Settings

All settings use the `gitMessageGenerator` prefix.

| Setting | Type | Default | Description |
|---|---|---|---|
| `provider` | string | `chutes` | Provider: `chutes`, `opencode-zen`, or `opencode-go` |
| `chutesApiKey` | string | — | Chutes.ai API key (`cpk_...`) |
| `opencodeZenKey` | string | — | OpenCode Zen / Go API key |
| `model` | string | — | Model ID. Use `gitMessageGenerator: Select Model` to browse |
| `commitStyle` | string | `conventional` | Style: `conventional`, `imperative`, or a custom style name |
| `customStyles` | object | `{}` | Named custom prompts. Key = style name, value = system prompt |
| `temperature` | number | `0.3` | Generation temperature (0–2) |
| `maxTokens` | number | `512` | Max response tokens (64–2048) |
| `autoFallback` | boolean | `true` | Auto-switch to another model if configured one fails |
| `customPrompt` | string | — | Full system prompt override — takes priority over all style settings |

---

## Commit styles

### Built-in

| Style | Example | Description |
|---|---|---|
| `conventional` | `feat(api): add user auth endpoint` | [Conventional Commits](https://www.conventionalcommits.org/) spec |
| `imperative` | `add user auth endpoint to api` | Plain imperative, no prefix |

Use `Ctrl+Shift+P` → `gitMessageGenerator: Select Commit Style` to switch, or set `commitStyle` directly.

### Custom styles

Define your own in settings. Works at global or workspace scope for per-project defaults.

```json
{
  "gitMessageGenerator.customStyles": {
    "jira": "You are a commit message generator. Prefix every commit with the JIRA ticket from the branch name. Format: ABC-123: description",
    "minimal": "Generate a single-line commit message in imperative mood. Max 50 characters. No prefixes, no explanation."
  }
}
```

Then set `gitMessageGenerator.commitStyle` to `jira` or `minimal`. Custom styles appear in the style picker.

Per-project example (`.vscode/settings.json`):

```json
{
  "gitMessageGenerator.commitStyle": "jira",
  "gitMessageGenerator.customStyles": {
    "jira": "Prefix every commit with the JIRA ticket from the branch name. Format: ABC-123: description"
  }
}
```

The `customPrompt` setting overrides all style settings if set — use it for quick one-off overrides.

---

## Commands

| Command | UI | Description |
|---|---|---|
| `gitMessageGenerator: Generate Commit Message` | `$(sparkle)` SCM button | Generate a commit message from staged changes |
| `gitMessageGenerator: Select Model` | `$(server)` SCM button | Browse live model list from active provider |
| `gitMessageGenerator: Select Commit Style` | `$(symbol-color)` SCM button | Switch between conventional, imperative, and custom styles |
| `gitMessageGenerator: Open Settings` | `$(gear)` SCM button | Open extension settings |

---

## How it works

```
Stage changes → Click sparkle → Extension gathers git context
                                       │
                                       ▼
                              Sends to provider API
                              (Chutes / Zen / Go)
                                       │
                                       ▼
                              Cleans LLM response
                              (strips markdown, quotes)
                                       │
                                       ▼
                              Writes to commit input box
                                       │
                                       ▼
                              You review and commit
```

**Context gathered per request:**
- Current branch name
- Last 5 commit messages
- Staged file list with statuses (added/modified/deleted/renamed)
- Per-file diffs (lock files excluded, binaries detected, large diffs truncated at 4000 chars)

**Auto-fallback:** If the configured model returns "not found", the extension queries the provider for active models, picks the first available one, retries, and saves the new model. Disable via `autoFallback: false`.

**Regeneration:** If there's already text in the input box when you generate, the model is instructed to produce a completely different message.

---

## Recommended models

### Chutes.ai

| Model | Notes |
|---|---|
| `Qwen/Qwen3-32B-TEE` | Default. Fast, great balance of speed and quality |
| `Qwen/Qwen3.5-397B-A17B-TEE` | Strong reasoning for complex diffs |
| `Qwen/Qwen3.6-27B-TEE` | Latest Qwen, excellent coding |
| `deepseek-ai/DeepSeek-V3.2-TEE` | DeepSeek's latest |
| `moonshotai/Kimi-K2.5-TEE` | Strong agentic reasoning |

### OpenCode Zen

| Model | Notes |
|---|---|
| `deepseek-v4-flash` | Default. Fast, cheap, strong at code |
| `deepseek-v4-flash-free` | Free tier |
| `qwen3.7-max` | Best Qwen available |
| `kimi-k2.6` | Strong agentic model |
| `glm-5.1` | Great for coding and agentic tasks |
| `claude-sonnet-4-5` | Balanced Claude |
| `gpt-5.4-mini` | Fast OpenAI |

### OpenCode Go

| Model | Notes |
|---|---|
| `deepseek-v4-flash` | Default |
| `minimax-m3` | Latest MiniMax |
| `kimi-k2.6` | Strong agentic |
| `qwen3.7-max` | Top Qwen |
| `glm-5.1` | Agentic coding |

> Browse live with `gitMessageGenerator: Select Model` — lists are fetched in real-time from each provider.

---

## Installation

### From source

```bash
git clone https://github.com/hithismani/gitmessagegenerator.git
cd gitmessagegenerator
npm install
npm run compile
```

Then in VS Code: `Ctrl+Shift+P` → `Developer: Install Extension from Location...` → select the folder.

### Package as .vsix

```bash
npm run package
code --install-extension gitmessagegenerator-0.2.0.vsix
```

---

## Migration from previous version

On first activation, settings from the old `chutesCommit.*` prefix are automatically copied to `gitMessageGenerator.*`.

---

## License

MIT
