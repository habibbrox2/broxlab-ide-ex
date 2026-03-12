import * as vscode from 'vscode';
import { BroxLabViewProvider } from './BroxLabViewProvider';
import { BroxLabCodeLensProvider } from './CodeLensProvider';
import { BroxLabBugDetector } from './BugDetectionProvider';
import { ProviderManager } from './ProviderManager';

let providerManager: ProviderManager;
let gitStatusBarItem: vscode.StatusBarItem;
let contextGlobal: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
    // Store context globally for use elsewhere
    contextGlobal = context;

    // Initialize ProviderManager for multi-provider model support
    providerManager = new ProviderManager(context);

    // Start automatic Ollama detection
    providerManager.startOllamaAutoDetect();

    // Initialize Git status bar
    initGitStatusBar(context);

    // Validate API key on startup
    validateApiKey(context);

    const provider = new BroxLabViewProvider(context.extensionUri, context, providerManager);
    const bugDetector = new BroxLabBugDetector(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(BroxLabViewProvider.viewType, provider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('broxlab.openSettings', () => {
            vscode.commands.executeCommand('broxlab-activitybar.focus');
            // Can add logic to auto-switch to settings tab if desired
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('broxlab.moveToSecondarySideBar', () => {
            vscode.commands.executeCommand('workbench.action.moveFocusedView');
            vscode.window.showInformationMessage('BroxLab AI: Use the quick pick to select "Secondary Side Bar", or drag the BroxLab icon to the right side of the screen!');
        })
    );

    // Register CodeLens Provider
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [{ scheme: 'file', language: 'typescript' }, { scheme: 'file', language: 'javascript' }],
            new BroxLabCodeLensProvider()
        )
    );

    // Register Inline Action Command
    context.subscriptions.push(
        vscode.commands.registerCommand('broxlab.action', async (action: string, uri: vscode.Uri, range: vscode.Range) => {
            const document = await vscode.workspace.openTextDocument(uri);
            // We use the first line of the function for context
            const codeLine = document.lineAt(range.start.line).text.trim();
            const relativePath = vscode.workspace.asRelativePath(uri);
            const prompt = `Please **${action}** the following function/class starting at line ${range.start.line + 1} in \`${relativePath}\`:\n\n\`\`\`javascript\n${codeLine}\n...\n\`\`\``;

            // Focus the view and send the message
            vscode.commands.executeCommand('broxlab-activitybar.focus');
            setTimeout(() => {
                provider.postMessageToWebview({ type: 'triggerAction', text: prompt });
            }, 300); // Give view time to initialize if it wasn't open
        })
    );

    // Register Ollama detection command
    context.subscriptions.push(
        vscode.commands.registerCommand('broxlab.detectOllama', async () => {
            const status = await providerManager.detectOllama();
            if (status.connected) {
                vscode.window.showInformationMessage(`🦙 Ollama Connected: ${status.models?.length || 0} models found`);
            } else {
                vscode.window.showWarningMessage(`🦙 Ollama not detected: ${status.error || 'Connection failed'}`);
            }
            // Refresh the view to show updated models
            provider.postMessageToWebview({ type: 'refreshModels' });
        })
    );

    // Register reset settings command
    context.subscriptions.push(
        vscode.commands.registerCommand('broxlab.resetSettings', async () => {
            const config = vscode.workspace.getConfiguration('broxlab');
            await config.update('defaultModel', 'anthropic/claude-3.7-sonnet', vscode.ConfigurationTarget.Global);
            await config.update('approvalMode', 'Ask Every Time', vscode.ConfigurationTarget.Global);
            await config.update('enableTerminalInvoke', true, vscode.ConfigurationTarget.Global);
            await config.update('enableTokenTracking', true, vscode.ConfigurationTarget.Global);
            await config.update('enableAutoContext', false, vscode.ConfigurationTarget.Global);
            await config.update('enableVisionSupport', true, vscode.ConfigurationTarget.Global);
            await config.update('enableCodeLens', true, vscode.ConfigurationTarget.Global);
            await config.update('enableProactiveBugDetection', false, vscode.ConfigurationTarget.Global);

            // Clear stored API key
            await context.secrets.store('openrouter-api-key', '');

            vscode.window.showInformationMessage('BroxLab AI: Settings have been reset to defaults.');
            provider.postMessageToWebview({ type: 'settingsReset' });
        })
    );
}

// Git Status Bar Function
function initGitStatusBar(context: vscode.ExtensionContext) {
    gitStatusBarItem = vscode.window.createStatusBarItem(
        'broxlab.gitStatus',
        vscode.StatusBarAlignment.Left,
        100
    );
    gitStatusBarItem.text = '$(git-branch) Loading...';
    gitStatusBarItem.tooltip = 'BroxLab: Click to check Git status';
    gitStatusBarItem.command = 'broxlab.checkGitStatus';

    context.subscriptions.push(gitStatusBarItem);
    context.subscriptions.push(
        vscode.commands.registerCommand('broxlab.checkGitStatus', async () => {
            await updateGitStatus();
        })
    );

    // Update on workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            updateGitStatus();
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateGitStatus();
        })
    );

    // Initial update
    updateGitStatus();
    gitStatusBarItem.show();
}

async function updateGitStatus() {
    if (!gitStatusBarItem) return;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        gitStatusBarItem.text = '$(git-branch) No Repo';
        return;
    }

    try {
        const { execSync } = require('child_process');
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspaceRoot, encoding: 'utf8' }).trim();
        const status = execSync('git status --porcelain', { cwd: workspaceRoot, encoding: 'utf8' }).trim();

        const changes = status ? status.split('\n').length : 0;

        if (changes > 0) {
            gitStatusBarItem.text = `$(git-branch) ${branch} (${changes} changes)`;
            gitStatusBarItem.color = '#f9e2af';
        } else {
            gitStatusBarItem.text = `$(git-branch) ${branch}`;
            gitStatusBarItem.color = '#a6e3a1';
        }
    } catch (e) {
        gitStatusBarItem.text = '$(git-branch) No Git';
    }
}

// API Key Validation
async function validateApiKey(context: vscode.ExtensionContext) {
    try {
        const apiKey = await context.secrets.get('openrouter-api-key');
        if (!apiKey || apiKey.trim() === '') {
            vscode.window.showWarningMessage('BroxLab AI: Please set your OpenRouter API key in Settings to start using the extension.');
            return;
        }

        // Validate key by making a simple request
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://broxlab.online',
                'X-OpenRouter-Title': 'BroxLab AI VSCode'
            }
        });

        if (!response.ok) {
            vscode.window.showWarningMessage('BroxLab AI: API key validation failed. Please check your API key in Settings.');
        }
    } catch (error) {
        console.error('API key validation error:', error);
    }
}

export function deactivate() {
    if (gitStatusBarItem) {
        gitStatusBarItem.dispose();
    }
}
