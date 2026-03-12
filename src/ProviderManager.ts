import * as vscode from 'vscode';

export interface ModelInfo {
    id: string;
    name: string;
    provider: string;
    pricing: {
        prompt: string;
        completion: string;
    };
    context_length?: number;
    architecture?: string;
}

export interface Provider {
    id: string;
    name: string;
    icon: string;
    isLocal: boolean;
    baseUrl?: string;
    apiKey?: string;
}

export interface ProviderStatus {
    providerId: string;
    connected: boolean;
    error?: string;
    models?: ModelInfo[];
    lastChecked?: Date;
}

export class ProviderManager {
    private context: vscode.ExtensionContext;
    private providerStatuses: Map<string, ProviderStatus> = new Map();
    private ollamaAutoDetectInterval: NodeJS.Timeout | null = null;
    private onStatusChangeCallbacks: ((statuses: Map<string, ProviderStatus>) => void)[] = [];

    // Default providers
    private providers: Provider[] = [
        {
            id: 'openrouter',
            name: 'OpenRouter',
            icon: '🌐',
            isLocal: false,
            baseUrl: 'https://openrouter.ai/api/v1'
        },
        {
            id: 'ollama',
            name: 'Ollama',
            icon: '🦙',
            isLocal: true,
            baseUrl: 'http://localhost:11434'
        }
    ];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public getProviders(): Provider[] {
        return this.providers;
    }

    public async fetchModelsForProvider(providerId: string): Promise<ModelInfo[]> {
        const config = vscode.workspace.getConfiguration('broxlab');
        const models: ModelInfo[] = [];

        try {
            switch (providerId) {
                case 'openrouter': {
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
                            pricing: m.pricing || { prompt: "0", completion: "0" },
                            context_length: m.context_length,
                            architecture: m.architecture
                        }));
                        models.push(...openrouterModels);
                    }
                    break;
                }

                case 'ollama': {
                    const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
                    const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');

                    const ollamaRes = await fetch(`${baseUrl}/api/tags`);
                    if (ollamaRes.ok) {
                        const ollamaData = await ollamaRes.json() as any;
                        const ollamaModels = ollamaData.models.map((m: any) => ({
                            id: `ollama/${m.name}`,
                            name: `🦙 ${m.name}`,
                            provider: 'Ollama',
                            pricing: { prompt: "0", completion: "0" },
                            context_length: m.details?.context_length,
                            architecture: m.model
                        }));
                        models.push(...ollamaModels);
                    }
                    break;
                }
            }

            // Update status
            this.providerStatuses.set(providerId, {
                providerId,
                connected: models.length > 0,
                models,
                lastChecked: new Date()
            });

        } catch (error: any) {
            this.providerStatuses.set(providerId, {
                providerId,
                connected: false,
                error: error.message,
                lastChecked: new Date()
            });
        }

        this.notifyStatusChange();
        return models;
    }

    public async fetchAllModels(): Promise<{ models: ModelInfo[], providers: ProviderStatus[] }> {
        const allModels: ModelInfo[] = [];
        const statuses: ProviderStatus[] = [];

        // Fetch OpenRouter models
        const openrouterModels = await this.fetchModelsForProvider('openrouter');
        allModels.push(...openrouterModels);

        // Try to detect and fetch Ollama models
        const ollamaModels = await this.fetchModelsForProvider('ollama');

        // Only add Ollama models if connected
        const ollamaStatus = this.providerStatuses.get('ollama');
        if (ollamaStatus?.connected) {
            allModels.push(...ollamaModels);
        }

        // Get all provider statuses
        for (const provider of this.providers) {
            const status = this.providerStatuses.get(provider.id);
            if (status) {
                statuses.push(status);
            }
        }

        return { models: allModels, providers: statuses };
    }

    public async detectOllama(): Promise<ProviderStatus> {
        const config = vscode.workspace.getConfiguration('broxlab');
        const ollamaUrl = config.get<string>('localModelUrl', 'http://localhost:11434/api/generate');
        const baseUrl = ollamaUrl.replace('/api/generate', '').replace('/v1/chat/completions', '').replace(/\/$/, '');

        try {
            const response = await fetch(`${baseUrl}/api/tags`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000) // 5 second timeout
            });

            if (response.ok) {
                const data = await response.json() as any;
                const models = data.models?.map((m: any) => ({
                    id: `ollama/${m.name}`,
                    name: `🦙 ${m.name}`,
                    provider: 'Ollama',
                    pricing: { prompt: "0", completion: "0" }
                })) || [];

                const status: ProviderStatus = {
                    providerId: 'ollama',
                    connected: true,
                    models,
                    lastChecked: new Date()
                };
                this.providerStatuses.set('ollama', status);
                this.notifyStatusChange();
                return status;
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error: any) {
            const status: ProviderStatus = {
                providerId: 'ollama',
                connected: false,
                error: error.message || 'Connection failed',
                lastChecked: new Date()
            };
            this.providerStatuses.set('ollama', status);
            this.notifyStatusChange();
            return status;
        }
    }

    public startOllamaAutoDetect(): void {
        // Initial detection
        this.detectOllama();

        // Set up periodic detection (every 30 seconds)
        if (this.ollamaAutoDetectInterval) {
            clearInterval(this.ollamaAutoDetectInterval);
        }

        this.ollamaAutoDetectInterval = setInterval(() => {
            this.detectOllama();
        }, 30000);
    }

    public stopOllamaAutoDetect(): void {
        if (this.ollamaAutoDetectInterval) {
            clearInterval(this.ollamaAutoDetectInterval);
            this.ollamaAutoDetectInterval = null;
        }
    }

    public getProviderStatus(providerId: string): ProviderStatus | undefined {
        return this.providerStatuses.get(providerId);
    }

    public getAllStatuses(): ProviderStatus[] {
        return Array.from(this.providerStatuses.values());
    }

    public onStatusChange(callback: (statuses: Map<string, ProviderStatus>) => void): void {
        this.onStatusChangeCallbacks.push(callback);
    }

    private notifyStatusChange(): void {
        for (const callback of this.onStatusChangeCallbacks) {
            callback(this.providerStatuses);
        }
    }

    public groupModelsByProvider(models: ModelInfo[]): Map<string, ModelInfo[]> {
        const grouped = new Map<string, ModelInfo[]>();

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

    public getDefaultModels(): ModelInfo[] {
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
}
