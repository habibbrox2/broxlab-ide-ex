# Contributing to BroxLab AI

Thank you for your interest in contributing to BroxLab AI!

## Development Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   cd broxlab-ai
   npm install
   ```
3. Build the webview:
   ```bash
   npm run build-webview
   ```
4. Compile TypeScript:
   ```bash
   npm run compile
   ```
4.1 Run lint to validate TypeScript/React:
   ```bash
   npm run lint
   ```
5. Press `F5` to open Extension Development Host

## Project Structure

```
broxlab-ai/
├── src/
│   ├── extension.ts       # Main entry point
│   ├── agent.ts           # AI agent with tool execution
│   ├── ProviderManager.ts # Model provider management
│   ├── BroxLabViewProvider.ts # WebView provider
│   ├── CodeLensProvider.ts    # CodeLens integration
│   └── BugDetectionProvider.ts # Bug detection
├── webview-ui/            # React frontend
│   ├── src/
│   │   ├── App.tsx       # Main app component
│   │   └── services/    # API services
│   └── package.json
└── package.json
```

## Code Style

- Use TypeScript for all new code
- Follow existing code conventions
- Add comments for complex logic
- Keep functions small and focused

## Submitting Changes

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request

## Reporting Issues

Please include:
- VS Code version
- Node.js version
- Steps to reproduce
- Expected vs actual behavior
