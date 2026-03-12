# BroxLab AI

<p align="center">
  <img src="https://img.shields.io/badge/VSCode-Extension-blue" alt="VSCode Extension">
  <img src="https://img.shields.io/badge/Version-0.0.1-green" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

BroxLab AI is an autonomous coding assistant that works directly from your VS Code activity bar! Using OpenRouter API, it can understand your code, write new code, run terminal commands, and even perform real-time web searches.

---

## Features

- **Autonomous**: BroxLab AI can read, write, and delete files in your project on its own
- **Terminal Commands**: Run builds, tests, and other terminal commands directly
- **Web Search Plugin**: Search the internet for latest documentation or solutions in real-time
- **Advanced Settings Panel**: Easily change API Key and Model via the Settings tab
- **Clear Chat**: One-click to clear chat history and start fresh
- **Proactive Bug Detection**: Enable to automatically find bugs in your code
- **CodeLens**: Show Explain, Refactor, Fix buttons above functions

---

## Installation

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
3.1 Run `npm run lint` to verify TypeScript builds cleanly
4. Press `F5` to open Extension Development Host
5. Or package with `npx vsce package` and install the .vsix file

---

## Configuration

### Get Started

1. Go to the **Settings** tab
2. Enter your **OpenRouter API Key** (get one at [openrouter.ai](https://openrouter.ai))
3. Select your preferred **Model** (e.g., `anthropic/claude-3.7-sonnet`)
4. Click **Save Settings**

### Local Models (Ollama)

BroxLab AI also supports local models via Ollama:
1. Install [Ollama](https://ollama.com)
2. Run `ollama serve` in terminal
3. The extension will auto-detect available models
4. Select a model starting with `ollama/` in Settings

### Approval Modes

- **Ask Every Time** (Safest) - Confirm each action
- **Ask Once Per Session** - Approve once, then all actions proceed
- **Auto Approve** (Fastest) - All actions execute automatically

---

## Usage Examples

### Write Code
> "Create an index.html file and script.js file with a simple todo list app"

### Run Terminal Command
> "Run npm install express"

### Delete File
> "Delete index.html from my project"

### Web Search
> "Search the internet for how OpenRouter's new Web Search API works"

### Refactor and Read Code
> "Read the agent.ts file in the src folder and explain how the delete_file tool works"

### Git Operations
> "Show me the git status"
> "What's the recent commit history?"
> "Show me the diff for the current changes"
> "Suggest a commit message for my changes"
> "Commit my changes with an AI-generated message"

---

## Commands

| Command | Description |
|---------|-------------|
| `broxlab.setApiKey` | Set OpenRouter API Key |
| `broxlab.openSettings` | Open BroxLab Settings |
| `broxlab.moveToSecondarySideBar` | Move to Secondary Side Bar |
| `broxlab.detectOllama` | Manually detect Ollama models |
| `broxlab.checkGitStatus` | Check Git status in status bar |
| `broxlab.resetSettings` | Reset all settings to defaults |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` then type "BroxLab" | Access BroxLab commands |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `defaultModel` | anthropic/claude-3.7-sonnet | Default OpenRouter model |
| `customPrompt` | (template) | Prompt enhancement template |
| `approvalMode` | Ask Every Time | Confirmation behavior |
| `enableTerminalInvoke` | true | Allow terminal commands |
| `enableTokenTracking` | true | Show token usage |
| `enableAutoContext` | false | Enable RAG context |
| `enableVisionSupport` | true | Image analysis |
| `enableCodeLens` | true | Show action buttons |
| `enableProactiveBugDetection` | false | Auto bug scanning |
| `localModelUrl` | http://localhost:11434 | Ollama URL |
| `featuresMode` | Full | Feature restrictions |
| `autoSelectModel` | false | Auto model selection |

---

## Troubleshooting

- **API Key not working**: Make sure you have credits in your OpenRouter account
- **Ollama not detected**: Ensure Ollama is running (`ollama serve`)
- **WebView not loading**: Run `npm run build-webview` and restart VS Code
- **CodeLens not showing**: Enable `enableCodeLens` in settings

---

## Requirements

- VS Code 1.90.0 or higher
- Node.js 18+ 
- OpenRouter API Key

---

## License

MIT

---

<p align="center">Made with ❤️ by BroxLab</p>
