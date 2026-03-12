import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from './agent';
import { ProviderManager, ProviderStatus } from './ProviderManager';

export class BroxLabViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'broxlab.chatView';

    private _view?: vscode.WebviewView;
    private providerManager?: ProviderManager;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        providerManager?: ProviderManager
    ) {
        this.providerManager = providerManager;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        const webviewFolder = vscode.Uri.joinPath(this._extensionUri, 'out', 'webview');

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [webviewFolder]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, webviewFolder);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'webviewLoaded': {
                    const apiKey = await this._context.secrets.get('openrouter_api_key');
                    const config = vscode.workspace.getConfiguration('broxlab');
                    const model = config.get('defaultModel', 'anthropic/claude-3.7-sonnet');
                    const savedHistory = this._context.workspaceState.get<any[]>('broxlab.chatHistory', []);

                    if (this._view) {
                        this._view.webview.postMessage({
                            type: 'settingsLoaded',
                            apiKey: apiKey || '',
                            model: model,
                            customPrompt: config.get('customPrompt', ''),
                            approvalMode: config.get('approvalMode', 'Ask Every Time'),
                            localModelUrl: config.get('localModelUrl', 'http://localhost:11434/api/generate'),
                            history: savedHistory
                        });
                    }
                    break;
                }
                case 'saveSettings': {
                    if (data.apiKey) {
                        await this._context.secrets.store('openrouter_api_key', data.apiKey);
                    }
                    const config = vscode.workspace.getConfiguration('broxlab');
                    await config.update('defaultModel', data.model, vscode.ConfigurationTarget.Global);
                    await config.update('customPrompt', data.customPrompt, vscode.ConfigurationTarget.Global);
                    await config.update('approvalMode', data.approvalMode, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('BroxLab AI Settings Saved');
                    break;
                }
                case 'fetchModels': {
                    try {
                        let models: any[] = [];
                        let providerStatuses: ProviderStatus[] = [];
                        const config = vscode.workspace.getConfiguration('broxlab');

                        // Use ProviderManager if available
                        if (this.providerManager) {
                            const result = await this.providerManager.fetchAllModels();
                            models = result.models;
                            providerStatuses = result.providers;
                        } else {
                            // Fallback to original implementation
                            try {
                                const result = await fetch("https://openrouter.ai/api/v1/models", {
                                    headers: {
                                        "HTTP-Referer": "https://broxlab.online",
                                        "X-OpenRouter-Title": "BroxLab AI VSCode"
                                    }
                                });
                                if (result.ok) {
                                    const json = await result.json() as any;
                                    const openrouterModels = (json.data as any[]).map((m: any) => ({
                                        id: m.id,
                                        name: m.name || m.id,
                                        provider: 'OpenRouter',
                                        pricing: m.pricing || { prompt: "0", completion: "0" }
                                    }));
                                    models = [...models, ...openrouterModels];
                                }
                            } catch (e) {
                                console.log('OpenRouter fetch failed, using fallback models');
                            }

                            try {
                                const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
                                const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');
                                const ollamaRes = await fetch(`${baseUrl}/api/tags`);
                                if (ollamaRes.ok) {
                                    const ollamaData = await ollamaRes.json() as any;
                                    const ollamaModels = ollamaData.models.map((m: any) => ({
                                        id: `ollama/${m.name}`,
                                        name: `🦙 ${m.name}`,
                                        provider: 'Ollama',
                                        pricing: { prompt: "0", completion: "0" }
                                    }));
                                    models = [...ollamaModels, ...models];
                                }
                            } catch (e) {
                                // Ollama might not be running
                            }
                        }

                        if (models.length === 0) {
                            models = this.getDefaultModels();
                        } else {
                            models.sort((a, b) => {
                                const priceA = parseFloat(a.pricing?.prompt || "0");
                                const priceB = parseFloat(b.pricing?.prompt || "0");
                                if (priceA !== priceB) return priceA - priceB;
                                return (a.name || a.id).localeCompare(b.name || b.id);
                            });
                            const popularModels = this.getDefaultModels().filter(dm =>
                                !models.some(m => m.id === dm.id)
                            );
                            models = [...popularModels, ...models];
                        }

                        // Group models by provider for the UI
                        const groupedModels = this.groupModelsByProvider(models);

                        this._view?.webview.postMessage({
                            type: 'modelsLoaded',
                            models: models,
                            providerStatuses: providerStatuses,
                            groupedModels: Array.from(groupedModels.entries()).map(([provider, providerModels]) => ({
                                provider,
                                models: providerModels
                            }))
                        });
                    } catch (err) {
                        console.error('Failed to fetch models', err);
                        this._view?.webview.postMessage({
                            type: 'modelsLoaded',
                            models: this.getDefaultModels()
                        });
                    }
                    break;
                }
                case 'clearHistory': {
                    await this._context.workspaceState.update('broxlab.chatHistory', []);
                    break;
                }
                case 'insertCode': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        editor.edit(editBuilder => {
                            editBuilder.insert(editor.selection.active, data.text);
                        });
                        vscode.window.showInformationMessage('Code inserted at cursor.');
                    } else {
                        vscode.window.showWarningMessage('No active editor to insert code into.');
                    }
                    break;
                }
                case 'replaceCode': {
                    const editor = vscode.window.activeTextEditor;
                    if (editor) {
                        const selection = editor.selection;
                        if (!selection.isEmpty) {
                            editor.edit(editBuilder => {
                                editBuilder.replace(selection, data.text);
                            });
                            vscode.window.showInformationMessage('Selection replaced with code.');
                        } else {
                            vscode.window.showWarningMessage('Please select some text to replace first.');
                        }
                    } else {
                        vscode.window.showWarningMessage('No active editor.');
                    }
                    break;
                }
                case 'selectFiles': {
                    const files = await vscode.window.showOpenDialog({
                        canSelectMany: true,
                        openLabel: 'Attach Files',
                        filters: { 'All Files': ['*'] }
                    });
                    if (files && files.length > 0) {
                        const attachments = files.map(f => ({
                            uri: f.toString(),
                            name: vscode.workspace.asRelativePath(f)
                        }));
                        this._view?.webview.postMessage({
                            type: 'filesSelected',
                            attachments: attachments
                        });
                    }
                    break;
                }
                case 'searchFiles': {
                    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
                    const items = files.map(f => ({
                        label: vscode.workspace.asRelativePath(f),
                        uri: f.toString()
                    }));
                    const selected = await vscode.window.showQuickPick(items, {
                        canPickMany: true,
                        placeHolder: 'Search project files to context...'
                    });
                    if (selected && selected.length > 0) {
                        const attachments = selected.map(s => ({
                            uri: s.uri,
                            name: s.label
                        }));
                        this._view?.webview.postMessage({
                            type: 'filesSelected',
                            attachments: attachments
                        });
                    }
                    break;
                }
                case 'sendMessage': {
                    const apiKey = await this._context.secrets.get('openrouter_api_key');
                    if (!apiKey) {
                        this._view?.webview.postMessage({
                            type: 'addMessage',
                            message: { role: 'assistant', content: 'Please configure your OpenRouter API Key in the Settings tab first.' }
                        });
                        return;
                    }

                    const agent = new Agent(apiKey);
                    const editor = vscode.window.activeTextEditor;
                    let contextPrefix = '';
                    if (editor) {
                        const fileName = editor.document.fileName;
                        const language = editor.document.languageId;
                        const selection = editor.document.getText(editor.selection);
                        contextPrefix = `[CONTEXT: The user is currently viewing file '${fileName}' (${language}).`;
                        if (selection) {
                            contextPrefix += ` They have selected the following code:\n\`\`\`\n${selection}\n\`\`\`\n`;
                        }
                        contextPrefix += `]\n\n`;
                    }

                    const config = vscode.workspace.getConfiguration('broxlab');
                    const enableVision = config.get<boolean>('enableVisionSupport', true);

                    let attachmentsContent = '';
                    let imageContents: any[] = [];
                    if (data.attachments && data.attachments.length > 0) {
                        for (const att of data.attachments) {
                            try {
                                const uri = vscode.Uri.parse(att.uri);
                                const content = await vscode.workspace.fs.readFile(uri);
                                const ext = att.name.substring(att.name.lastIndexOf('.')).toLowerCase();
                                const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);

                                if (isImage && enableVision) {
                                    const base64 = Buffer.from(content).toString('base64');
                                    let mime = 'image/jpeg';
                                    if (ext === '.png') mime = 'image/png';
                                    else if (ext === '.webp') mime = 'image/webp';
                                    else if (ext === '.gif') mime = 'image/gif';

                                    imageContents.push({
                                        type: "image_url",
                                        image_url: { url: `data:${mime};base64,${base64}` }
                                    });
                                } else {
                                    attachmentsContent += `\n[ATTACHMENT: ${att.name}]\n\`\`\`\n${Buffer.from(content).toString('utf8')}\n\`\`\`\n`;
                                }
                            } catch (e) {
                                console.error(`Failed to read attachment ${att.name}`, e);
                            }
                        }
                    }

                    const promptText = contextPrefix + attachmentsContent + data.text;
                    let finalPromptPayload: any = promptText;
                    if (imageContents.length > 0) {
                        finalPromptPayload = [
                            { type: "text", text: promptText },
                            ...imageContents
                        ];
                    }

                    const newHistory = [...data.history, { role: 'user', content: data.text }];
                    await this._context.workspaceState.update('broxlab.chatHistory', newHistory);

                    this._view?.webview.postMessage({
                        type: 'addMessage',
                        message: { role: 'user', content: data.text }
                    });

                    try {
                        const model = data.model || config.get('defaultModel', 'anthropic/claude-3.7-sonnet');
                        await agent.handleRequest(finalPromptPayload, data.history, async (update: any) => {
                            if (this._view) {
                                this._view.webview.postMessage({
                                    type: 'agentUpdate',
                                    update
                                });
                            }
                        }, model);
                    } catch (err: any) {
                        this._view?.webview.postMessage({
                            type: 'agentUpdate',
                            update: { type: 'error', text: err.message }
                        });
                    }
                    break;
                }
            }
        });
    }

    private getDefaultModels(): any[] {
        return [
            { id: 'openai/gpt-4o', name: '🟢 GPT-4o', provider: 'OpenRouter', pricing: { prompt: '0.0015', completion: '0.006' } },
            { id: 'openai/gpt-4o-mini', name: '🟢 GPT-4o Mini', provider: 'OpenRouter', pricing: { prompt: '0.00015', completion: '0.0006' } },
            { id: 'anthropic/claude-3.7-sonnet', name: '🔵 Claude 3.7 Sonnet', provider: 'OpenRouter', pricing: { prompt: '0.003', completion: '0.015' } },
            { id: 'anthropic/claude-3.5-sonnet', name: '🔵 Claude 3.5 Sonnet', provider: 'OpenRouter', pricing: { prompt: '0.003', completion: '0.015' } },
            { id: 'google/gemini-2.0-flash-exp', name: '🟣 Gemini 2.0 Flash', provider: 'OpenRouter', pricing: { prompt: '0', completion: '0' } },
            { id: 'google/gemini-1.5-pro', name: '🟣 Gemini 1.5 Pro', provider: 'OpenRouter', pricing: { prompt: '0.00125', completion: '0.005' } },
            { id: 'google/gemini-1.5-flash', name: '🟣 Gemini 1.5 Flash', provider: 'OpenRouter', pricing: { prompt: '0.000075', completion: '0.0003' } },
            { id: 'meta-llama/llama-3.3-70b-instruct', name: '🟠 Llama 3.3 70B', provider: 'OpenRouter', pricing: { prompt: '0.0009', completion: '0.0009' } },
            { id: 'mistralai/mistral-large', name: '⚡ Mistral Large', provider: 'OpenRouter', pricing: { prompt: '0.002', completion: '0.006' } },
            { id: 'deepseek/deepseek-chat', name: '🔷 DeepSeek Chat', provider: 'OpenRouter', pricing: { prompt: '0.00014', completion: '0.00028' } },
            { id: 'google/gemma-2-9b-it', name: '🎁 Gemma 2 9B (Free)', provider: 'OpenRouter', pricing: { prompt: '0', completion: '0' } }
        ];
    }

    private groupModelsByProvider(models: any[]): Map<string, any[]> {
        const grouped = new Map<string, any[]>();

        for (const model of models) {
            const provider = model.provider || 'Other';
            if (!grouped.has(provider)) {
                grouped.set(provider, []);
            }
            grouped.get(provider)!.push(model);
        }

        // Sort providers: Local first (Ollama), then OpenRouter, then others
        const sortOrder = ['Ollama', 'OpenRouter', 'Other'];
        const sorted = new Map(
            Array.from(grouped.entries()).sort(([a], [b]) => {
                const indexA = sortOrder.indexOf(a);
                const indexB = sortOrder.indexOf(b);
                if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                return a.localeCompare(b);
            })
        );

        return sorted;
    }

    public postMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, webviewFolder: vscode.Uri) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BroxLab AI</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root { --padding: 8px; --border-radius: 6px; --border-radius-lg: 12px; --glass-bg: rgba(255,255,255,0.05); --glass-border: rgba(255,255,255,0.1); --accent-color: var(--vscode-button-background); --accent-hover: var(--vscode-button-hoverBackground); --transition: all 0.2s ease; --font-sans: 'Outfit','Inter',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; --font-mono: 'JetBrains Mono','Fira Code','Cascadia Code','Consolas',Monaco,var(--vscode-editor-font-family,monospace); }
        * { box-sizing: border-box; }
        body { font-family: var(--font-sans); color: var(--vscode-foreground); background-color: var(--vscode-sideBar-background); padding: 0; margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; font-size: 13px; line-height: 1.5; }
        .header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); min-height: 44px; }
        .header-left { display: flex; align-items: center; gap: 10px; }
        .agent-avatar { width: 26px; height: 26px; border-radius: 50%; background: linear-gradient(135deg,#6366f1,#8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; color: white; flex-shrink: 0; }
        .agent-info { display: flex; flex-direction: column; }
        .agent-name { font-size: 13px; font-weight: 600; color: var(--vscode-foreground); display: flex; align-items: center; gap: 6px; }
        .agent-status { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .header-actions { display: flex; gap: 4px; }
        .header-btn { background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; padding: 4px 8px; border-radius: 4px; font-size: 12px; transition: var(--transition); display: flex; align-items: center; gap: 4px; }
        .header-btn:hover { background: var(--glass-bg); color: var(--vscode-foreground); }
        .tabs { display: flex; background: var(--vscode-editor-background); padding: 0 12px; border-bottom: 1px solid var(--vscode-panel-border); gap: 2px; }
        .tab { padding: 10px 14px; cursor: pointer; opacity: 0.7; font-size: 12px; font-weight: 500; border-bottom: 2px solid transparent; transition: var(--transition); color: var(--vscode-descriptionForeground); }
        .tab:hover { opacity: 1; color: var(--vscode-foreground); }
        .tab.active { opacity: 1; color: var(--accent-color); border-bottom-color: var(--accent-color); }
        .tab-content { display: none; flex: 1; flex-direction: column; overflow: hidden; }
        .tab-content.active { display: flex; }
        #settings-content { padding: 16px; overflow-y: auto; gap: 12px; display: flex; flex-direction: column; }
        .setting-row { display: flex; flex-direction: column; gap: 6px; }
        .setting-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); }
        .setting-input { padding: 8px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: var(--border-radius); font-size: 13px; outline: none; transition: var(--transition); }
        .setting-input:focus { border-color: var(--vscode-focusBorder); }
        .setting-select { padding: 8px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: var(--border-radius); font-size: 13px; outline: none; cursor: pointer; }
        .setting-help { font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
        .save-btn { background: var(--accent-color); color: var(--vscode-button-foreground); border: none; padding: 10px 16px; border-radius: var(--border-radius); cursor: pointer; font-weight: 600; font-size: 12px; transition: var(--transition); margin-top: 8px; }
        .save-btn:hover { background: var(--accent-hover); }
        #chat-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        #chat-history { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 2px; }
        .message-row { display: flex; gap: 8px; padding: 4px 8px; animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .message-row.user { flex-direction: row-reverse; }
        .message-avatar { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0; }
        .message-avatar.assistant { background: linear-gradient(135deg,#6366f1,#8b5cf6); color: white; }
        .message-avatar.user { background: var(--accent-color); color: var(--vscode-button-foreground); }
        .message-avatar.system { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--vscode-descriptionForeground); font-size: 10px; }
        .message-bubble { max-width: 85%; padding: 8px 12px; border-radius: var(--border-radius-lg); font-size: 13px; line-height: 1.5; word-wrap: break-word; }
        .message-row.assistant .message-bubble { background: var(--vscode-editor-background); border: 1px solid var(--glass-border); border-top-left-radius: 4px; }
        .message-row.user .message-bubble { background: var(--accent-color); color: var(--vscode-button-foreground); border-top-right-radius: 4px; }
        .message-row.system .message-bubble { background: transparent; color: var(--vscode-descriptionForeground); font-style: italic; font-size: 12px; max-width: 90%; opacity: 0.8; }
        .message-row.tool .message-bubble { background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-panel-border); font-family: var(--font-mono); font-size: 12px; max-width: 95%; border-radius: var(--border-radius); }
        .message-bubble .code-block { margin: 8px 0; border-radius: var(--border-radius); overflow: hidden; border: 1px solid var(--glass-border); }
        .message-bubble .code-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--glass-border); font-size: 11px; }
        .message-bubble .code-lang { text-transform: uppercase; color: var(--accent-color); font-weight: 600; }
        .message-bubble .code-actions { display: flex; gap: 12px; }
        .message-bubble .code-actions a { color: var(--vscode-descriptionForeground); text-decoration: none; opacity: 0.7; cursor: pointer; }
        .message-bubble .code-actions a:hover { opacity: 1; color: var(--accent-color); }
        .message-bubble pre { margin: 0; padding: 12px; overflow-x: auto; background: var(--vscode-textCodeBlock-background); font-family: var(--font-mono); font-size: 12px; }
        .input-container { padding: 8px 12px 12px; background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border); }
        .input-toolbar { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
        .toolbar-select { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--vscode-foreground); border-radius: 4px; padding: 4px 8px; font-size: 11px; outline: none; cursor: pointer; max-width: 140px; }
        .toolbar-select:hover { border-color: var(--vscode-focusBorder); }
        .toolbar-btn { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--vscode-foreground); border-radius: 4px; padding: 4px 10px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: var(--transition); }
        .toolbar-btn:hover { background: rgba(255,255,255,0.1); border-color: var(--vscode-focusBorder); }
        .input-wrapper { display: flex; align-items: flex-end; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: var(--border-radius-lg); transition: var(--transition); }
        .input-wrapper:focus-within { border-color: var(--vscode-focusBorder); }
        #chat-input { flex: 1; background: transparent; color: var(--vscode-input-foreground); border: none; padding: 10px 14px; resize: none; font-family: inherit; font-size: 13px; outline: none; min-height: 40px; max-height: 120px; line-height: 1.4; }
        #chat-input::placeholder { color: var(--vscode-placeholderForeground); }
        #send-button { background: var(--accent-color); color: var(--vscode-button-foreground); border: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: var(--border-radius); margin: 4px; transition: var(--transition); flex-shrink: 0; }
        #send-button:hover:not(:disabled) { background: var(--accent-hover); }
        #send-button:disabled { opacity: 0.5; cursor: not-allowed; }
        #send-button svg { width: 14px; height: 14px; fill: currentColor; }
        .attachments-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px 8px 4px; }
        .attachment-item { background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 4px; padding: 2px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px; }
        .remove-attachment { cursor: pointer; opacity: 0.5; font-size: 10px; }
        .remove-attachment:hover { opacity: 1; color: var(--vscode-errorForeground); }
        .token-stats { display: none; justify-content: space-between; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 4px 8px; background: var(--glass-bg); border-radius: 4px; margin-bottom: 8px; }
        .token-stats.visible { display: flex; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <div class="agent-avatar">B</div>
            <div class="agent-info">
                <div class="agent-name">BroxLab AI <span style="font-weight:400;opacity:0.6;font-size:11px;">v1.0</span></div>
                <div class="agent-status" id="agent-status">Ready</div>
            </div>
        </div>
        <div class="header-actions">
            <button class="header-btn" id="clear-chat-btn" title="Clear Chat">🗑️ Clear</button>
            <button class="header-btn" id="open-settings-btn" title="Settings">⚙️</button>
        </div>
    </div>
    <div class="tabs">
        <div class="tab active" data-target="chat-content">Chat</div>
        <div class="tab" data-target="settings-content">Settings</div>
    </div>
    <div id="chat-content" class="tab-content active">
        <div id="chat-history"></div>
        <div class="input-container">
            <div id="token-stats" class="token-stats">
                <span>Tokens: <span id="token-count">0</span></span>
                <span>Cost: $<span id="token-cost">0.0000</span></span>
            </div>
            <div class="input-toolbar">
                <select id="chat-mode-select" class="toolbar-select" title="Chat Mode">
                    <option value="Standard">Standard</option>
                    <option value="Architect">Architect</option>
                    <option value="Research">Research</option>
                </select>
                <select id="chat-model-select" class="toolbar-select" title="Model"><option>Loading...</option></select>
                <button id="attach-btn" class="toolbar-btn" title="Attach Files">📎 Attach</button>
                <button id="search-project-btn" class="toolbar-btn" title="Search Files">🔍 Search</button>
            </div>
            <div class="input-wrapper">
                <textarea id="chat-input" rows="1" placeholder="Ask BroxLab AI..."></textarea>
                <button id="send-button" title="Send (Enter)"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg></button>
            </div>
            <div id="attachments-container" class="attachments-list" style="display:none;"></div>
        </div>
    </div>
    <div id="settings-content" class="tab-content">
        <div class="setting-row">
            <label class="setting-label">OpenRouter API Key</label>
            <input type="password" id="api-key-input" class="setting-input" placeholder="sk-or-v1-..." />
            <div class="setting-help">Your key is stored securely in VS Code's secret storage.</div>
        </div>
        <div class="setting-row">
            <label class="setting-label">Approval Mode</label>
            <select id="approval-mode-input" class="setting-select">
                <option value="Auto Approve">Auto Approve (Fastest)</option>
                <option value="Ask Every Time">Ask Every Time (Safest)</option>
                <option value="Ask Once Per Session">Ask Once Per Session</option>
            </select>
        </div>
        <div class="setting-row">
            <label class="setting-label">Primary Model</label>
            <div style="display:flex;gap:8px;">
                <select id="model-select" class="setting-select" style="flex:1;"><option value="anthropic/claude-3.7-sonnet">Loading models...</option></select>
                <button id="refresh-models-btn" class="toolbar-btn" title="Refresh Models">↻</button>
                <button id="detect-ollama-btn" class="toolbar-btn" title="Detect Ollama">🦙</button>
            </div>
            <div class="setting-help" id="ollama-status"></div>
        </div>
        <div class="setting-row">
            <label class="setting-label">Custom Prompt Template</label>
            <textarea id="custom-prompt-input" class="setting-input" rows="3" placeholder="Use \${userInput} as placeholder..." style="resize:vertical;font-family:inherit;"></textarea>
            <div class="setting-help">Instructions used to transform your prompt.</div>
        </div>
        <button class="save-btn" id="save-settings-btn">Save Settings</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const renderer = new marked.Renderer();
        renderer.code = function(code, language) {
            const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
            const highlighted = hljs.highlight(code, { language: validLanguage }).value;
            const encoded = encodeURIComponent(code);
            return \`<div class="code-block">
                <div class="code-header">
                    <span class="code-lang">\${language || 'text'}</span>
                    <div class="code-actions">
                        <a href="#" onclick="copyChatCode(this, decodeURIComponent('\${encoded}')); return false;">Copy</a>
                        <a href="#" onclick="vscode.postMessage({ type: 'insertCode', text: decodeURIComponent('\${encoded}') }); return false;">Insert</a>
                        <a href="#" onclick="vscode.postMessage({ type: 'replaceCode', text: decodeURIComponent('\${encoded}') }); return false;">Replace</a>
                    </div>
                </div>
                <pre><code class="hljs \${language}">\${highlighted}</code></pre>
            </div>\`;
        };
        marked.setOptions({ renderer });

        function copyChatCode(element, text) {
            navigator.clipboard.writeText(text);
            const originalText = element.innerText;
            element.innerText = 'Copied!';
            setTimeout(() => { element.innerText = originalText; }, 2000);
        }

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.target).classList.add('active');
            });
        });

        const chatHistory = document.getElementById('chat-history');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-button');
        const agentStatus = document.getElementById('agent-status');
        const apiKeyInput = document.getElementById('api-key-input');
        const modelSelect = document.getElementById('model-select');
        const chatModelSelect = document.getElementById('chat-model-select');
        const chatModeSelect = document.getElementById('chat-mode-select');
        const approvalModeInput = document.getElementById('approval-mode-input');
        const customPromptInput = document.getElementById('custom-prompt-input');
        const saveBtn2 = document.getElementById('save-settings-btn');
        const refreshModelsBtn = document.getElementById('refresh-models-btn');
        const attachBtn = document.getElementById('attach-btn');
        const attachmentsContainer = document.getElementById('attachments-container');
        const clearChatBtn = document.getElementById('clear-chat-btn');
        const openSettingsBtn = document.getElementById('open-settings-btn');
        const detectOllamaBtn = document.getElementById('detect-ollama-btn');
        const ollamaStatus = document.getElementById('ollama-status');

        let messageHistory = [];
        let currentModel = 'anthropic/claude-3.7-sonnet';
        let attachedFiles = [];
        let modelPricing = {};
        let sessionTokens = 0;
        let sessionCost = 0;

        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        modelSelect.addEventListener('change', () => { chatModelSelect.value = modelSelect.value; });
        chatModelSelect.addEventListener('change', () => { modelSelect.value = chatModelSelect.value; });

        openSettingsBtn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('.tab[data-target="settings-content"]').classList.add('active');
            document.getElementById('settings-content').classList.add('active');
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'settingsLoaded':
                    apiKeyInput.value = message.apiKey;
                    currentModel = message.model;
                    modelSelect.value = currentModel;
                    approvalModeInput.value = message.approvalMode || 'Ask Every Time';
                    customPromptInput.value = message.customPrompt || '';
                    messageHistory = message.history || [];
                    renderHistory();
                    vscode.postMessage({ type: 'fetchModels' });
                    break;
                case 'modelsLoaded':
                    updateModelSelects(message.models, message.groupedModels, message.providerStatuses);
                    break;
                case 'addMessage':
                    appendMessage(message.message.role, message.message.content);
                    break;
                case 'agentUpdate':
                    handleAgentUpdate(message.update);
                    break;
                case 'triggerAction':
                    chatInput.value = message.text;
                    sendMessage();
                    break;
                case 'filesSelected':
                    message.attachments.forEach(att => {
                        if (!attachedFiles.find(f => f.uri === att.uri)) {
                            attachedFiles.push(att);
                        }
                    });
                    renderAttachments();
                    break;
                case 'tokenUsage':
                    updateTokenStats(message.usage, message.model);
                    break;
                case 'refreshModels':
                    // Handle refresh models message from extension
                    vscode.postMessage({ type: 'fetchModels' });
                    break;
            }
        });

        function updateTokenStats(usage, modelId) {
            const statsDiv = document.getElementById('token-stats');
            if (!statsDiv) return;
            statsDiv.classList.add('visible');
            const promptTokens = usage.prompt_tokens || 0;
            const completionTokens = usage.completion_tokens || 0;
            sessionTokens += (promptTokens + completionTokens);
            const pricing = modelPricing[modelId];
            if (pricing) {
                const costPrompt = (promptTokens * parseFloat(pricing.prompt || '0'));
                const costCompletion = (completionTokens * parseFloat(pricing.completion || '0'));
                sessionCost += (costPrompt + costCompletion);
            }
            document.getElementById('token-count').innerText = sessionTokens.toLocaleString();
            document.getElementById('token-cost').innerText = sessionCost.toFixed(4);
        }

        function updateModelSelects(models, groupedModels, providerStatuses) {
            const selects = [modelSelect, chatModelSelect];
            selects.forEach(sel => {
                sel.innerHTML = '';
                let found = false;
                
                // If we have grouped models, use them
                if (groupedModels && groupedModels.length > 0) {
                    groupedModels.forEach(function(group) {
                        // Add provider group header
                        const providerStatus = providerStatuses && providerStatuses.find(function(ps) { return ps.providerId.toLowerCase() === group.provider.toLowerCase(); });
                        const isConnected = providerStatus && providerStatus.connected;
                        const statusIcon = isConnected ? '🟢' : '⚪';
                        const groupLabel = document.createElement('option');
                        groupLabel.disabled = true;
                        groupLabel.textContent = '── ' + statusIcon + ' ' + group.provider + ' ──';
                        sel.appendChild(groupLabel);
                        
                        group.models.forEach(function(m) {
                            const isFree = parseFloat(m.pricing && m.pricing.prompt || "0") === 0;
                            modelPricing[m.id] = m.pricing || { prompt: "0", completion: "0" };
                            const opt = document.createElement('option');
                            opt.value = m.id;
                            opt.textContent = '   ' + (isFree ? '🎁 ' : '') + (m.name || m.id);
                            opt.dataset.provider = group.provider;
                            if (m.id === currentModel) found = true;
                            sel.appendChild(opt);
                        });
                    });
                } else {
                    // Fallback to flat list
                    models.forEach(function(m) {
                        const isFree = parseFloat(m.pricing && m.pricing.prompt || "0") === 0;
                        modelPricing[m.id] = m.pricing || { prompt: "0", completion: "0" };
                        const opt = document.createElement('option');
                        opt.value = m.id;
                        opt.textContent = (isFree ? '🎁 ' : '') + (m.name || m.id);
                        if (m.id === currentModel) found = true;
                        sel.appendChild(opt);
                    });
                }
                
                if (!found && currentModel) {
                    const opt = document.createElement('option');
                    opt.value = currentModel;
                    opt.textContent = currentModel + ' (Custom)';
                    sel.appendChild(opt);
                }
                sel.value = currentModel;
            });
        }

        function renderAttachments() {
            if (attachedFiles.length === 0) {
                attachmentsContainer.style.display = 'none';
                return;
            }
            attachmentsContainer.style.display = 'flex';
            attachmentsContainer.innerHTML = '';
            attachedFiles.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'attachment-item';
                item.innerHTML = \`<span>\${file.name}</span><span class="remove-attachment" onclick="removeAttachment(\${index})">✕</span>\`;
                attachmentsContainer.appendChild(item);
            });
        }

        window.removeAttachment = (index) => {
            attachedFiles.splice(index, 1);
            renderAttachments();
        };

        function renderHistory() {
            chatHistory.innerHTML = '';
            if (messageHistory.length === 0) {
                appendMessage('system', '👋 Hi! I\\'m BroxLab AI. How can I help you today?');
            } else {
                messageHistory.forEach(msg => {
                    if (msg.role === 'user') appendMessage('user', msg.content);
                    else if (msg.role === 'assistant' && msg.content) appendMessage('assistant', msg.content);
                    else if (msg.role === 'tool') appendMessage('tool', msg.name + '\\n' + msg.content);
                });
            }
        }

        vscode.postMessage({ type: 'webviewLoaded' });

        refreshModelsBtn.addEventListener('click', () => {
            modelSelect.innerHTML = '<option>Loading...</option>';
            chatModelSelect.innerHTML = '<option>Loading...</option>';
            vscode.postMessage({ type: 'fetchModels' });
        });

        detectOllamaBtn.addEventListener('click', () => {
            if (ollamaStatus) {
                ollamaStatus.textContent = 'Detecting Ollama...';
            }
            // Trigger the command to detect Ollama
            vscode.postMessage({ type: 'refreshModels' });
        });

        attachBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'selectFiles' });
        });

        document.getElementById('search-project-btn').addEventListener('click', () => {
            vscode.postMessage({ type: 'searchFiles' });
        });

        saveBtn2.addEventListener('click', () => {
            vscode.postMessage({
                type: 'saveSettings',
                apiKey: apiKeyInput.value,
                model: modelSelect.value,
                approvalMode: approvalModeInput.value,
                customPrompt: customPromptInput.value
            });
        });

        clearChatBtn.addEventListener('click', () => {
            messageHistory = [];
            sessionTokens = 0;
            sessionCost = 0;
            document.getElementById('token-count').innerText = '0';
            document.getElementById('token-cost').innerText = '0.0000';
            document.getElementById('token-stats').classList.remove('visible');
            chatHistory.innerHTML = '';
            appendMessage('system', '👋 Hi! I\\'m BroxLab AI. How can I help you today?');
            vscode.postMessage({ type: 'clearHistory' });
        });

        sendBtn.addEventListener('click', sendMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        function sendMessage() {
            const text = chatInput.value.trim();
            if (!text && attachedFiles.length === 0) return;
            vscode.postMessage({
                type: 'sendMessage',
                text: text,
                history: messageHistory,
                model: chatModelSelect.value,
                mode: chatModeSelect.value,
                attachments: attachedFiles
            });
            messageHistory.push({ role: 'user', content: text });
            chatInput.value = '';
            chatInput.style.height = 'auto';
            attachedFiles = [];
            renderAttachments();
        }

        function appendMessage(role, content) {
            const row = document.createElement('div');
            row.className = 'message-row ' + role;
            let avatarText = 'B';
            if (role === 'user') avatarText = 'U';
            if (role === 'system') avatarText = 'i';
            const avatar = document.createElement('div');
            avatar.className = 'message-avatar ' + role;
            avatar.textContent = avatarText;
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            if (role === 'assistant') {
                bubble.innerHTML = marked.parse(content);
            } else {
                bubble.textContent = content;
            }
            row.appendChild(avatar);
            row.appendChild(bubble);
            chatHistory.appendChild(row);
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }

        function handleAgentUpdate(update) {
            if (update.type === 'progress') {
                agentStatus.textContent = update.text;
                appendMessage('system', update.text);
            } else if (update.type === 'tool') {
                agentStatus.textContent = 'Using tool: ' + update.name;
                appendMessage('tool', update.name + '\\n' + update.result);
                messageHistory.push({ role: 'assistant', tool_calls: [ { function: { name: update.name } } ] });
                messageHistory.push({ role: 'tool', content: update.result, name: update.name });
            } else if (update.type === 'text') {
                agentStatus.textContent = 'Ready';
                appendMessage('assistant', update.text);
                messageHistory.push({ role: 'assistant', content: update.text });
            } else if (update.type === 'error') {
                agentStatus.textContent = 'Error';
                appendMessage('system', 'Error: ' + update.text);
            } else if (update.type === 'thinking') {
                agentStatus.textContent = 'Thinking...';
            }
        }
    </script>
</body>
</html>`;
    }
}
