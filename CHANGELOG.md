# Changelog

All notable changes to BroxLab AI will be documented in this file.

## [0.0.2] - Unreleased

### Added
- Git integration tools (git_status, git_diff, git_log, git_branch)
- Git status in VS Code status bar (shows branch and changes)
- Confirmation dialog before executing git commands
- Reset settings command
- Keyboard shortcut: `Ctrl+Shift+L` (Mac: `Cmd+Shift+L`)
- vsce added to devDependencies for easier packaging
- AI suggest commit message (git_suggest_commit)
- Git commit tool with AI-generated messages (git_commit)
- Features mode setting (Full, Code Only, Git Only, Terminal Only, Read Only)
- Auto model selection based on task

### Changed
- Default view is now Chat (not Settings)

## [0.0.1] - 2026-03-12

### Added
- Autonomous coding assistant using OpenRouter API
- Terminal command execution support
- Web search plugin via OpenRouter
- Advanced settings panel with API key and model configuration
- Clear chat functionality
- Proactive bug detection
- CodeLens integration (Explain, Refactor, Fix buttons)
- Multi-model support (OpenRouter + Ollama)
- Token tracking and cost estimation
- Auto-context (RAG) for relevant file retrieval
- Vision support for image analysis
- Keyboard shortcut: `Ctrl+Shift+L` (Mac: `Cmd+Shift+L`)

### Fixed
- CSS syntax errors
- Configuration type errors
- Memory leak issues (added dispose methods)
- Session state management
- JSON parsing crash prevention
- TypeScript configuration
- Fixed parsing issues caused by unterminated template literals in the WebView UI

### Technical
- Built with TypeScript
- VS Code Extension API v1.90.0+
- WebView-based UI with React
