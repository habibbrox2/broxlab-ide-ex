import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Retry helper with exponential backoff
async function fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 3
): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok || attempt === maxRetries) {
                return response;
            }
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        } catch (error) {
            lastError = error as Error;
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }
    throw lastError || new Error('Request failed after retries');
}

const SYSTEM_PROMPT = `You are BroxLab AI, a powerful autonomous coding assistant for VS Code.

You can analyze projects, write code, refactor existing files, run terminal commands, and perform web searches to help the developer.

### Your Capabilities:
1. **Workspace Analysis**: Use \`list_files\` and \`read_file\` to understand the project structure and contents.
2. **Code Search**: Use \`search_workspace\` to find specific code or patterns.
3. **Modifying Code**: 
   - Use \`edit_file\` to replace specific blocks of code in existing files.
   - Use \`write_file\` to create new files or overwrite existing ones.
   - Use \`delete_file\` to remove files.
4. **Terminal**: Use \`run_terminal\` to execute commands (e.g., npm install, tests, builds).
5. **Web Search**: You have access to a web search plugin (via OpenRouter). Use it to find latest documentation or solutions.

### Working Rules:
1. **Think First**: Always analyze the request and plan your steps.
2. **Read Before Writing**: Never assume file content. Always use \`read_file\` or \`search_workspace\` before editing.
3. **Safety First**: Make minimal, precise changes.
4. **Error Handling**: If a tool fails, explain why and try an alternative approach.
5. **Clarity**: Explain what you did and summarize changes at the end.

When calling tools, use the standard tool calling mechanism.`;

const TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file from the workspace",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path of the file"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "edit_file",
            "description": "Edit part of a file by replacing a specific search string with a new replace string.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "search": { "type": "string", "description": "Exact code block to replace" },
                    "replace": { "type": "string", "description": "New code block" }
                },
                "required": ["path", "search", "replace"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_workspace",
            "description": "Search files in the workspace (using grep)",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "The text or regex to search for in the workspace" }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in a directory",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative path to list (e.g. '.' or 'src')" }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_terminal",
            "description": "Execute a terminal command",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" }
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create a new file with the given content",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_diagnostics",
            "description": "Read the active VS Code errors, warnings, and problems in the current workspace.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "Delete a file from the workspace",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": { "type": "string" }
                },
                "required": ["path"]
            }
        }
    },
    // Git Tools
    {
        "type": "function",
        "function": {
            "name": "git_status",
            "description": "Check Git status - shows modified, staged, and untracked files",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_diff",
            "description": "Show Git diff of changes",
            "parameters": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "Specific file to diff (optional)" }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_log",
            "description": "Show recent Git commit history",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": { "type": "number", "description": "Number of commits to show (default 10)" }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_branch",
            "description": "List Git branches and show current branch",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_commit",
            "description": "Stage and commit changes with an AI-generated commit message. Requires user approval.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "Commit message (optional, will be auto-generated if not provided)" },
                    "all": { "type": "boolean", "description": "Stage all changed files automatically (default true)" }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_suggest_commit",
            "description": "AI suggests a commit message based on current changes (does not commit)",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    }
];

export class Agent {
    private sessionApproved = false;
    private apiKey: string;
    private workspaceRoot: string;

    constructor(apiKey: string, context?: vscode.ExtensionContext) {
        this.apiKey = apiKey;
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    }

    // Sanitize terminal command to prevent injection
    private sanitizeCommand(command: string): string {
        // Remove potential command injection characters
        const dangerous = /[;&|`$]/g;
        return command.replace(dangerous, '').trim();
    }

    // Prevent path traversal attacks
    private isPathSafe(relativePath: string): boolean {
        const resolved = path.resolve(this.workspaceRoot, relativePath);
        return resolved.startsWith(this.workspaceRoot);
    }

    private resolvePath(relativePath: string): string {
        if (path.isAbsolute(relativePath)) {
            return relativePath;
        }
        const resolved = path.resolve(this.workspaceRoot, relativePath);
        // Ensure resolved path is within workspace
        if (!resolved.startsWith(this.workspaceRoot)) {
            throw new Error('Path outside workspace not allowed');
        }
        return resolved;
    }

    private async executeTool(name: string, args: any, onUpdate: (update: any) => void): Promise<string> {
        if (!this.workspaceRoot) {
            return "Error: No workspace open.";
        }

        const config = vscode.workspace.getConfiguration('broxlab');
        const approvalMode = config.get<string>('approvalMode', 'Ask Every Time');
        let needsApproval = ['edit_file', 'write_file', 'delete_file', 'run_terminal'].includes(name);

        // Git commands always need approval
        const isGitCommand = ['git_status', 'git_diff', 'git_log', 'git_branch', 'git_commit', 'git_suggest_commit'].includes(name);
        if (isGitCommand) {
            needsApproval = true;
        }

        let userApproved = false;

        if (needsApproval && approvalMode !== 'Auto Approve') {
            if (approvalMode === 'Ask Once Per Session' && this.sessionApproved) {
                userApproved = true;
            } else {
                while (!userApproved) {
                    let message = `BroxLab AI wants to execute: ${name}`;
                    if (name === 'run_terminal') message += `\nCommand: ${args.command}`;
                    if (name === 'edit_file' || name === 'write_file' || name === 'delete_file') {
                        message += ` on ${path.basename(args.path)}`;
                    }

                    const actions = ['Allow', 'Reject'];
                    if (name === 'edit_file' || name === 'write_file') {
                        actions.splice(1, 0, 'View Changes');
                    }

                    const selection = await vscode.window.showWarningMessage(message, { modal: true }, ...actions);

                    if (selection === 'Allow') {
                        userApproved = true;
                        if (approvalMode === 'Ask Once Per Session') this.sessionApproved = true;
                    } else if (selection === 'View Changes') {
                        // Generate diff
                        const filePath = this.resolvePath(args.path);
                        const originalUri = vscode.Uri.file(filePath);
                        const tempPath = path.join(os.tmpdir(), `broxlab-diff-${Date.now()}-${path.basename(filePath)}`);

                        let newContent = args.content || '';
                        if (name === 'edit_file') {
                            if (fs.existsSync(filePath)) {
                                const fileContent = fs.readFileSync(filePath, 'utf8');
                                newContent = fileContent.replace(args.search, args.replace);
                            }
                        }

                        fs.writeFileSync(tempPath, newContent);
                        const tempUri = vscode.Uri.file(tempPath);

                        await vscode.commands.executeCommand('vscode.diff', originalUri, tempUri, `Proposed Changes for ${path.basename(filePath)}`);
                        // continue loop to ask again
                    } else {
                        return "Error: Operation cancelled by the user.";
                    }
                }
            }
        }

        try {
            switch (name) {
                case 'read_diagnostics': {
                    const diagnostics = vscode.languages.getDiagnostics();
                    const result = [];
                    for (const [uri, diags] of diagnostics) {
                        // Only include diagnostics for files in the current workspace
                        if (uri.fsPath.startsWith(this.workspaceRoot) && diags.length > 0) {
                            const fileErrors = diags.map(d => {
                                const severity = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' :
                                    d.severity === vscode.DiagnosticSeverity.Warning ? 'Warning' : 'Info';
                                return `[Line ${d.range.start.line + 1}] ${severity}: ${d.message}`;
                            });
                            result.push(`File: ${uri.fsPath}\n` + fileErrors.join('\n'));
                        }
                    }
                    return result.length > 0 ? result.join('\n\n') : 'No active errors or warnings found.';
                }
                case 'read_file': {
                    const filePath = this.resolvePath(args.path);
                    return fs.readFileSync(filePath, 'utf8');
                }
                case 'edit_file': {
                    const filePath = this.resolvePath(args.path);
                    if (!fs.existsSync(filePath)) {
                        return `Error: File not found at ${args.path}`;
                    }
                    const fileContent = fs.readFileSync(filePath, 'utf8');

                    if (!fileContent.includes(args.search)) {
                        return "Error: Could not find the exact text specified in 'search'. Please ensure the search block matches exactly, including whitespace and line endings.";
                    }

                    // Count occurrences
                    const occurrences = fileContent.split(args.search).length - 1;
                    if (occurrences > 1) {
                        return `Error: Found ${occurrences} occurrences of the search text. Please provide a more specific search block to avoid ambiguous replacements.`;
                    }

                    const updated = fileContent.replace(args.search, args.replace);
                    fs.writeFileSync(filePath, updated);
                    return "File updated successfully.";
                }
                case 'write_file': {
                    const filePath = this.resolvePath(args.path);
                    fs.mkdirSync(path.dirname(filePath), { recursive: true });
                    fs.writeFileSync(filePath, args.content);
                    return "File written successfully.";
                }
                case 'delete_file': {
                    const filePath = this.resolvePath(args.path);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                        return "File deleted successfully.";
                    } else {
                        return "Error: File does not exist.";
                    }
                }
                case 'run_terminal': {
                    const config = vscode.workspace.getConfiguration('broxlab');
                    if (!config.get<boolean>('enableTerminalInvoke', true)) {
                        return "Error: Terminal execution is disabled in settings.";
                    }

                    // Sanitize command to prevent injection
                    const sanitizedCommand = this.sanitizeCommand(args.command);
                    if (sanitizedCommand !== args.command) {
                        return "Error: Command contains potentially dangerous characters.";
                    }

                    return new Promise((resolve) => {
                        let fullOutput = "";
                        const isWin = process.platform === "win32";
                        const shell = isWin ? "cmd.exe" : "/bin/sh";
                        const shellArgs = isWin ? ["/c", args.command] : ["-c", args.command];

                        const child = spawn(shell, shellArgs, { cwd: this.workspaceRoot });

                        child.stdout.on('data', (data) => {
                            const text = data.toString();
                            fullOutput += text;
                            onUpdate({ type: 'progress', text: `> ${text.trim()}` });
                        });

                        child.stderr.on('data', (data) => {
                            const text = data.toString();
                            fullOutput += text;
                            onUpdate({ type: 'progress', text: `> [Err] ${text.trim()}` });
                        });

                        child.on('close', (code) => {
                            resolve(fullOutput || (code === 0 ? "Command executed successfully with no output." : `Command failed with exit code ${code}`));
                        });

                        child.on('error', (err) => {
                            resolve(`Terminal Error: ${err.message}`);
                        });
                    });
                }
                case 'list_files': {
                    const dirPath = this.resolvePath(args.path || '.');
                    const files = fs.readdirSync(dirPath);
                    return files.join('\n');
                }
                case 'search_workspace': {
                    const isWin = process.platform === "win32";
                    // Avoid node_modules and other junk directories
                    // On Windows, findstr doesn't have a simple exclude-dir, so we use a more complex approach or just filter files
                    // But for simplicity and cross-platform robustness, we can try to use a more specific glob or filter in JS

                    let command;
                    if (isWin) {
                        // Using findstr /s /i with a filter to exclude node_modules paths
                        // This is tricky with raw exec, so let's use a better approach:
                        // Search only in src or exclude node_modules using a pipe if needed
                        command = `findstr /s /i /n "${args.query}" * | findstr /v /i "node_modules"`;
                    } else {
                        command = `grep -rn --exclude-dir=node_modules "${args.query}" .`;
                    }

                    try {
                        const { stdout, stderr } = await execAsync(command, { cwd: this.workspaceRoot });
                        return stdout || stderr || "No results found.";
                    } catch (err: any) {
                        // If grep/findstr returns non-zero, it often means no results or small errors
                        return err.stdout || err.stderr || "No results found or search failed.";
                    }
                }
                // Git Tools
                case 'git_status': {
                    try {
                        const { stdout, stderr } = await execAsync('git status --porcelain', { cwd: this.workspaceRoot });
                        if (!stdout.trim()) {
                            return "No changes in working directory (clean working tree).";
                        }
                        return `Git Status:\n${stdout}`;
                    } catch (err: any) {
                        return `Git error: ${err.message}. Make sure this is a Git repository.`;
                    }
                }
                case 'git_diff': {
                    try {
                        const fileArg = args.file ? ` -- ${args.file}` : '';
                        const { stdout, stderr } = await execAsync(`git diff${fileArg}`, { cwd: this.workspaceRoot });
                        if (!stdout.trim()) {
                            return "No diff output (working tree is clean or file has no changes).";
                        }
                        return `Git Diff:\n${stdout}`;
                    } catch (err: any) {
                        return `Git error: ${err.message}`;
                    }
                }
                case 'git_log': {
                    try {
                        const limit = args.limit || 10;
                        const { stdout, stderr } = await execAsync(`git log -${limit} --oneline`, { cwd: this.workspaceRoot });
                        if (!stdout.trim()) {
                            return "No commits found.";
                        }
                        return `Recent Commits:\n${stdout}`;
                    } catch (err: any) {
                        return `Git error: ${err.message}`;
                    }
                }
                case 'git_branch': {
                    try {
                        const { stdout, stderr } = await execAsync('git branch -a', { cwd: this.workspaceRoot });
                        const { stdout: branchStdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspaceRoot });
                        const currentBranch = branchStdout.trim();
                        return `Current Branch: ${currentBranch}\n\nAll Branches:\n${stdout}`;
                    } catch (err: any) {
                        return `Git error: ${err.message}`;
                    }
                }
                case 'git_suggest_commit': {
                    try {
                        // Get the diff to analyze changes
                        const { stdout: diffOutput } = await execAsync('git diff --cached', { cwd: this.workspaceRoot }).catch(() => ({ stdout: '' }));
                        const { stdout: unstagedOutput } = await execAsync('git diff', { cwd: this.workspaceRoot }).catch(() => ({ stdout: '' }));

                        const changes = (diffOutput + '\n' + unstagedOutput).slice(0, 5000);

                        if (!changes.trim()) {
                            return "No changes found to suggest a commit message.";
                        }

                        // Use AI to suggest a commit message
                        onUpdate({ type: 'progress', text: 'AI is analyzing changes to suggest a commit message...' });

                        const suggestPrompt = `Based on the following git diff/changes, suggest a concise and descriptive commit message following conventional commits format (e.g., feat: add new feature, fix: resolve bug). Only return the commit message, nothing else:\n\n${changes}`;

                        const config = vscode.workspace.getConfiguration('broxlab');
                        const model = config.get('defaultModel', 'anthropic/claude-3.7-sonnet');
                        const isLocal = model.startsWith('ollama/');
                        const modelName = isLocal ? model.replace('ollama/', '') : model;

                        let apiUrl = "https://openrouter.ai/api/v1/chat/completions";
                        let headers: any = {
                            "Authorization": `Bearer ${this.apiKey}`,
                            "Content-Type": "application/json",
                            "HTTP-Referer": "https://broxlab.com",
                            "X-OpenRouter-Title": "BroxLab AI"
                        };

                        if (isLocal) {
                            const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
                            const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');
                            apiUrl = `${baseUrl}/v1/chat/completions`;
                            headers = { "Content-Type": "application/json" };
                        }

                        const response = await fetch(apiUrl, {
                            method: "POST",
                            headers: headers,
                            body: JSON.stringify({
                                model: modelName,
                                messages: [{ role: 'user', content: suggestPrompt }]
                            })
                        });

                        if (response.ok) {
                            const data = await response.json() as any;
                            const message = data.choices[0].message.content.trim();
                            return `Suggested Commit Message:\n\n${message}\n\nYou can use this message with the git_commit tool.`;
                        } else {
                            return "Failed to get AI suggestion. Please provide your own commit message.";
                        }
                    } catch (err: any) {
                        return `Error generating commit message: ${err.message}`;
                    }
                }
                case 'git_commit': {
                    try {
                        const shouldStageAll = args.all !== false;

                        // Stage changes
                        if (shouldStageAll) {
                            await execAsync('git add -A', { cwd: this.workspaceRoot });
                        }

                        // Get staged changes for the commit message
                        const { stdout: diffOutput } = await execAsync('git diff --cached', { cwd: this.workspaceRoot }).catch(() => ({ stdout: '' }));

                        let commitMessage = args.message;

                        // If no message provided, generate one
                        if (!commitMessage && diffOutput) {
                            onUpdate({ type: 'progress', text: 'Generating AI commit message...' });

                            const config = vscode.workspace.getConfiguration('broxlab');
                            const model = config.get('defaultModel', 'anthropic/claude-3.7-sonnet');
                            const isLocal = model.startsWith('ollama/');
                            const modelName = isLocal ? model.replace('ollama/', '') : model;

                            let apiUrl = "https://openrouter.ai/api/v1/chat/completions";
                            let headers: any = {
                                "Authorization": `Bearer ${this.apiKey}`,
                                "Content-Type": "application/json",
                                "HTTP-Referer": "https://broxlab.com",
                                "X-OpenRouter-Title": "BroxLab AI"
                            };

                            if (isLocal) {
                                const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
                                const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');
                                apiUrl = `${baseUrl}/v1/chat/completions`;
                                headers = { "Content-Type": "application/json" };
                            }

                            const suggestPrompt = `Based on the following git diff, suggest a concise commit message (max 72 characters). Only return the message:\n\n${diffOutput.slice(0, 5000)}`;

                            const response = await fetch(apiUrl, {
                                method: "POST",
                                headers: headers,
                                body: JSON.stringify({
                                    model: modelName,
                                    messages: [{ role: 'user', content: suggestPrompt }]
                                })
                            });

                            if (response.ok) {
                                const data = await response.json() as any;
                                commitMessage = data.choices[0].message.content.trim();
                            }
                        }

                        if (!commitMessage) {
                            return "Error: Please provide a commit message.";
                        }

                        const { stdout } = await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: this.workspaceRoot });
                        return `Successfully committed!\n\nMessage: ${commitMessage}\n\n${stdout || ''}`;
                    } catch (err: any) {
                        return `Git commit error: ${err.message}`;
                    }
                }
                default:
                    return `Unknown tool: ${name}`;
            }
        } catch (e: any) {
            return `Error executing tool: ${e.message}`;
        }
    }

    public async enhancePrompt(template: string, userInput: string): Promise<string> {
        const fullPrompt = template.replace('${userInput}', userInput);
        const config = vscode.workspace.getConfiguration('broxlab');
        const model = config.get('defaultModel', 'anthropic/claude-3.7-sonnet');
        const isLocal = model.startsWith('ollama/');
        const modelName = isLocal ? model.replace('ollama/', '') : model;

        const body = {
            model: modelName,
            messages: [{ role: 'user', content: fullPrompt }]
        };

        let apiUrl = "https://openrouter.ai/api/v1/chat/completions";
        let headers: any = {
            "Authorization": `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://broxlab.com",
            "X-OpenRouter-Title": "BroxLab AI VSCode"
        };

        if (isLocal) {
            const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
            const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');
            apiUrl = `${baseUrl}/v1/chat/completions`;
            headers = { "Content-Type": "application/json" };
        }

        const result = await fetch(apiUrl, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!result.ok) {
            const text = await result.text();
            throw new Error(`Enhancement API error: ${text}`);
        }

        const data = await result.json() as any;
        return data.choices[0].message.content.trim();
    }

    public async gatherAutoContext(prompt: string, onUpdate: (update: any) => void): Promise<string> {
        if (!this.workspaceRoot) return '';

        const stopWords = ['how', 'to', 'what', 'is', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'about', 'and', 'or', 'can', 'you', 'i', 'need', 'help', 'code', 'file', 'project', 'make', 'create', 'update', 'fix'];
        const words = prompt.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
        const keywords = words.filter(w => w.length > 2 && !stopWords.includes(w));

        if (keywords.length === 0) return '';

        onUpdate({ type: 'progress', text: 'Gathering auto-context (RAG)...' });

        try {
            const isWin = process.platform === "win32";
            const query = keywords.join(' ');
            let command = isWin
                ? `findstr /s /i /m "${query}" * | findstr /v /i "node_modules" | findstr /v /i ".git"`
                : `grep -rl --exclude-dir=node_modules --exclude-dir=.git -i "${query}" .`;

            const { stdout } = await execAsync(command, { cwd: this.workspaceRoot }).catch(() => ({ stdout: '' }));

            const files = stdout.split('\n').map(f => f.trim()).filter(f => f.length > 0).slice(0, 3);

            let context = '';
            for (const file of files) {
                const filePath = path.resolve(this.workspaceRoot, file);
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const snippet = content.split('\n').slice(0, 100).join('\n');
                    context += `\n[AUTO-CONTEXT: ${file}]\n\`\`\`\n${snippet}\n\`\`\`\n`;
                }
            }
            return context;
        } catch (e) {
            return '';
        }
    }

    public async handleRequest(prompt: string | any[], history: any[], onUpdate: (update: any) => void, model?: string) {
        if (!this.workspaceRoot) {
            onUpdate({ type: 'error', text: 'Please open a workspace before interacting.' });
            return;
        }

        const config = vscode.workspace.getConfiguration('broxlab');
        const enableAutoContext = config.get<boolean>('enableAutoContext', false);
        const selectedModel = model || config.get('defaultModel', 'anthropic/claude-3.7-sonnet');
        const isLocal = selectedModel.startsWith('ollama/');
        const modelName = isLocal ? selectedModel.replace('ollama/', '') : selectedModel;

        let finalPrompt = prompt;

        let promptText = typeof prompt === 'string' ? prompt : prompt.find((p: any) => p.type === 'text')?.text || '';

        if (enableAutoContext && promptText) {
            const autoContext = await this.gatherAutoContext(promptText, onUpdate);
            if (autoContext) {
                const formattedText = `[AUTOMATICALLY RETRIEVED CONTEXT]\n${autoContext}\n\n[USER REQUEST]\n${promptText}`;
                if (typeof finalPrompt === 'string') {
                    finalPrompt = formattedText;
                } else if (Array.isArray(finalPrompt)) {
                    // Update the text portion of the multimodal array
                    const textObj = finalPrompt.find((p: any) => p.type === 'text');
                    if (textObj) {
                        textObj.text = formattedText;
                    } else {
                        finalPrompt.unshift({ type: 'text', text: formattedText });
                    }
                }
            }
        }

        let messages: any[] = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: finalPrompt }
        ];

        let isCompleted = false;

        onUpdate({ type: 'progress', text: 'BroxLab AI thinking...' });

        while (!isCompleted) {
            const body: any = {
                model: modelName,
                messages: messages,
                tools: TOOLS
            };

            let apiUrl = "https://openrouter.ai/api/v1/chat/completions";
            let headers: any = {
                "Authorization": `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://broxlab.com",
                "X-OpenRouter-Title": "BroxLab AI VSCode"
            };

            if (!isLocal) {
                body.plugins = [{ id: "web" }]; // Enable OpenRouter web plug-in
                // Enable streaming
                body.stream = true;
            } else {
                const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
                const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');
                apiUrl = `${baseUrl}/v1/chat/completions`;
                headers = { "Content-Type": "application/json" };
            }

            const result = await fetch(apiUrl, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(body)
            });

            if (!result.ok) {
                const text = await result.text();
                throw new Error(`${isLocal ? 'Ollama' : 'OpenRouter'} API error (${result.status}): ${text}`);
            }

            // Handle streaming response for non-local models
            if (!isLocal && body.stream) {
                const reader = result.body?.getReader();
                const decoder = new TextDecoder();
                let streamingContent = '';
                let buffer = '';

                if (reader) {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (line.startsWith('data: ')) {
                                    const data = line.slice(6);
                                    if (data === '[DONE]') {
                                        isCompleted = true;
                                        break;
                                    }
                                    try {
                                        const parsed = JSON.parse(data);
                                        const content = parsed.choices?.[0]?.delta?.content;
                                        if (content) {
                                            streamingContent += content;
                                            onUpdate({ type: 'stream', text: content });
                                        }
                                    } catch (e) {
                                        // Skip invalid JSON
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // Stream ended
                    }
                }

                if (streamingContent) {
                    onUpdate({ type: 'text', text: streamingContent });
                }
                isCompleted = true;
            } else {
                const data = await result.json() as any;
                const message = data.choices[0].message;

                if (message.tool_calls && message.tool_calls.length > 0) {
                    // Keep the tool call in context
                    messages.push(message);

                    for (const toolCall of message.tool_calls) {
                        const funcName = toolCall.function.name;
                        const args = JSON.parse(toolCall.function.arguments);

                        let statusMsg = `Running tool: ${funcName}`;
                        if (funcName === 'edit_file') statusMsg = `Editing ${path.basename(args.path)}...`;
                        if (funcName === 'write_file') statusMsg = `Generating ${path.basename(args.path)}...`;
                        if (funcName === 'run_terminal') statusMsg = `Executing command...`;
                        if (funcName === 'search_workspace') statusMsg = `Searching workspace...`;

                        onUpdate({ type: 'progress', text: statusMsg });

                        const toolResult = await this.executeTool(funcName, args, onUpdate);

                        messages.push({
                            role: "tool",
                            content: toolResult,
                            tool_call_id: toolCall.id,
                            name: funcName
                        });

                        onUpdate({ type: 'tool', name: funcName, result: toolResult });
                    }
                } else {
                    // The assistant provided a normal response
                    onUpdate({ type: 'text', text: message.content });
                    isCompleted = true;
                }

                // Report token usage if enabled and available
                if (data.usage && config.get<boolean>('enableTokenTracking', true)) {
                    onUpdate({ type: 'tokenUsage', usage: data.usage, model: selectedModel });
                }
            }
        }
    }
}
