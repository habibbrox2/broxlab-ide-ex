import * as vscode from 'vscode';
import { Agent } from './agent';

export class BroxLabBugDetector {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private isScanning: boolean = false;

    constructor(private context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('broxlab-bugs');

        // Listen for save events
        this.context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((document) => {
                this.scanDocument(document);
            })
        );

        // Scan the active document on launch
        if (vscode.window.activeTextEditor) {
            this.scanDocument(vscode.window.activeTextEditor.document);
        }
    }

    private async scanDocument(document: vscode.TextDocument) {
        const config = vscode.workspace.getConfiguration('broxlab');
        if (!config.get<boolean>('enableProactiveBugDetection', false)) {
            this.diagnosticCollection.clear();
            return;
        }

        // Only scan valid code files
        const validLangs = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'python', 'go', 'java', 'csharp', 'cpp', 'c', 'php'];
        if (!validLangs.includes(document.languageId)) return;

        if (this.isScanning) return;
        this.isScanning = true;

        try {
            const apiKey = await this.context.secrets.get('openrouter_api_key');
            if (!apiKey) {
                this.isScanning = false;
                return;
            }

            const agent = new Agent(apiKey);
            const content = document.getText();

            // Skip large files to save tokens
            if (document.lineCount > 1000) {
                this.isScanning = false;
                return;
            }

            const prompt = `You are a proactive bug detector. Analyze the following ${document.languageId} code for logic errors, security vulnerabilities, or severe anti-patterns.
DO NOT report missing imports, trailing spaces, or minor styling issues that a standard linter caught. Focus ONLY on actual bugs (e.g., null pointers, off-by-one, injection risks).
Return ONLY a valid JSON array of objects.
Format: [{"line": <line_number_1_indexed>, "severity": "Error|Warning", "message": "description of bug"}]
If no bugs are found, return []. Code:\n\n\`\`\`\n${content}\n\`\`\``;

            // enhancePrompt replaces \${userInput} with our prompt
            const response = await agent.enhancePrompt('${userInput}', prompt);

            // Extract JSON from response
            const jsonStrMatch = response.match(/\[.*\]/);
            if (jsonStrMatch) {
                try {
                    const bugs = JSON.parse(jsonStrMatch[0]);
                    const diagnostics: vscode.Diagnostic[] = [];

                    for (const bug of bugs) {
                        if (bug.line && bug.message) {
                            const lineIndex = Math.max(0, bug.line - 1);
                            // Prevent out of bounds
                            if (lineIndex < document.lineCount) {
                                const lineLength = document.lineAt(lineIndex).text.length;
                                const range = new vscode.Range(lineIndex, 0, lineIndex, lineLength);

                                const severity = bug.severity === 'Warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
                                const diagnostic = new vscode.Diagnostic(range, `BroxLab AI: ${bug.message}`, severity);

                                diagnostics.push(diagnostic);
                            }
                        }
                    }

                    this.diagnosticCollection.set(document.uri, diagnostics);
                } catch (parseError) {
                    console.error('Failed to parse bug detection response:', parseError);
                    this.diagnosticCollection.set(document.uri, []);
                }
            } else {
                this.diagnosticCollection.set(document.uri, []);
            }
        } catch (e) {
            console.error("Proactive Bug Detection failed", e);
        } finally {
            this.isScanning = false;
        }
    }

    public dispose() {
        this.diagnosticCollection.clear();
        this.diagnosticCollection.dispose();
    }
}
