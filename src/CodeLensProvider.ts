import * as vscode from 'vscode';

export class BroxLabCodeLensProvider implements vscode.CodeLensProvider {
    private regex: RegExp;
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        // Simple regex to match function and class declarations in JS/TS
        this.regex = /function\s+([a-zA-Z0-9_]+)\s*\(|class\s+([a-zA-Z0-9_]+)\s*\{|(public|private|protected)?\s+(async\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(:[^\{]+)?\{/g;

        vscode.workspace.onDidChangeConfiguration(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const config = vscode.workspace.getConfiguration('broxlab');
        if (!config.get<boolean>('enableCodeLens', true)) {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        let matches;

        while ((matches = this.regex.exec(text)) !== null) {
            const line = document.positionAt(matches.index).line;
            const defaultStr = matches[1] || matches[2] || matches[5];
            if (!defaultStr) continue;

            const indexOf = matches[0].indexOf(defaultStr);
            const position = document.positionAt(matches.index + indexOf);
            const range = document.getWordRangeAtPosition(position, new RegExp(defaultStr));

            if (range) {
                codeLenses.push(new vscode.CodeLens(range, {
                    title: "✨ Explain",
                    command: "broxlab.action",
                    arguments: ["Explain", document.uri, range]
                }));

                codeLenses.push(new vscode.CodeLens(range, {
                    title: "🛠️ Refactor",
                    command: "broxlab.action",
                    arguments: ["Refactor", document.uri, range]
                }));

                codeLenses.push(new vscode.CodeLens(range, {
                    title: "🐛 Fix",
                    command: "broxlab.action",
                    arguments: ["Fix", document.uri, range]
                }));
            }
        }
        return codeLenses;
    }
}
