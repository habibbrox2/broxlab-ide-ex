import React, { useState, useEffect, useRef } from 'react';
import {
  Layout,
  Files,
  Search,
  GitBranch,
  Play,
  Settings,
  MessageSquare,
  Terminal as TerminalIcon,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  X,
  Send,
  Sparkles,
  Zap,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  Code,
  Trash2,
  Copy
} from 'lucide-react';
import Markdown from 'react-markdown';
import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import { cn } from './utils';
import { generateAIResponse } from './services/gemini';

// --- Types ---
type Tab = 'editor' | 'explorer' | 'git' | 'ai' | 'snippets' | 'settings';

interface Snippet {
  id: string;
  name: string;
  prefix: string;
  body: string;
  description: string;
  language: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isEditing?: boolean;
  status?: 'thinking' | 'reading' | 'editing' | 'searching' | 'executing' | 'complete';
}

interface GitFile {
  name: string;
  status: 'M' | 'A' | 'D' | 'U';
  staged: boolean;
}

interface AppSettings {
  theme: 'dark' | 'light' | 'high-contrast';
  fontSize: number;
  fontFamily: 'JetBrains Mono' | 'Inter';
  lineNumbers: boolean;
  wordWrap: boolean;
  aiModel: string;
  apiKey: string;
  provider: 'OpenRouter' | 'Ollama';
  localModelUrl: string;
  customPrompt: string;
  approvalMode: 'Auto Approve' | 'Ask Every Time' | 'Ask Once Per Session';
  autoSave: boolean;
  autoSaveDelay: number;
  formatOnSave: boolean;
  tabSize: number;
  keybindings: 'standard' | 'vim' | 'emacs';
}

// --- Components ---

const ActivityBarItem = ({
  icon: Icon,
  active,
  onClick,
  label
}: {
  icon: any,
  active: boolean,
  onClick: () => void,
  label: string
}) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full h-12 flex items-center justify-center transition-colors relative group",
      active ? "text-white border-l-2 border-white" : "text-zinc-500 hover:text-zinc-300"
    )}
    title={label}
  >
    <Icon size={24} strokeWidth={1.5} />
    {!active && (
      <div className="absolute left-14 bg-zinc-800 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50">
        {label}
      </div>
    )}
  </button>
);

const TabButton = ({ active, onClick, label, icon: Icon }: { active: boolean, onClick: () => void, label: string, icon: any }) => (
  <button
    onClick={onClick}
    className={cn(
      "px-4 h-full flex items-center gap-2 text-xs transition-colors border-r shrink-0",
      active
        ? "bg-[#151515] text-white border-t-2 border-t-blue-500 border-zinc-800"
        : "text-zinc-500 hover:text-zinc-300 hover:bg-[#1e1e1e] border-zinc-800"
    )}
  >
    <Icon size={14} className={active ? "text-blue-400" : "text-zinc-600"} />
    {label}
  </button>
);

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('editor');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm BroxLab AI. How can I help you with your code today?", timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['BroxLab Terminal v1.0.0', 'Type "help" for a list of commands.']);
  const [code, setCode] = useState(
    "// Welcome to BroxLab AI Assistant\n" +
    "function helloWorld() {\n" +
    "  console.log(\"Hello, BroxLab!\");\n" +
    "}\n\n" +
    "helloWorld();"
  );
  const [commitMessage, setCommitMessage] = useState('');
  const [gitFiles, setGitFiles] = useState<GitFile[]>([
    { name: 'src/App.tsx', status: 'M', staged: false },
    { name: 'src/services/gemini.ts', status: 'A', staged: false },
    { name: 'package.json', status: 'M', staged: false },
  ]);
  const vscodeRef = useRef<any>(typeof window !== 'undefined' ? (window as any).acquireVsCodeApi?.() : null);
  const vscode = vscodeRef.current;
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'dark',
    fontSize: 14,
    fontFamily: 'JetBrains Mono',
    lineNumbers: true,
    wordWrap: true,
    aiModel: 'gemini-3.1-pro-preview',
    apiKey: '••••••••••••••••',
    provider: 'OpenRouter',
    localModelUrl: 'http://localhost:11434/api/generate',
    customPrompt: 'Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes): ${userInput}',
    approvalMode: 'Ask Every Time',
    autoSave: true,
    autoSaveDelay: 1000,
    formatOnSave: false,
    tabSize: 2,
    keybindings: 'standard'
  });

  const [models, setModels] = useState<any[]>([]);
  const providerModels = models.filter((m: any) => m.provider === settings.provider);
  const hasProviderModels = providerModels.length > 0;
  const localModelBaseUrl = (settings.localModelUrl || '')
    .replace('/api/generate', '')
    .replace('/v1/chat/completions', '')
    .replace(/\/$/, '');
  const [tokenUsage, setTokenUsage] = useState<any | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<{ label: string; uri: string }[]>([]);
  const [gitStatus, setGitStatus] = useState<any>(null);

  // Message editing state
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  // AI status state
  const [aiStatus, setAiStatus] = useState<'idle' | 'thinking' | 'reading' | 'editing' | 'searching' | 'executing'>('idle');

  const [snippets, setSnippets] = useState<Snippet[]>([
    {
      id: '1',
      name: 'React Functional Component',
      prefix: 'rfc',
      body: "import React from 'react';\n\nconst ${1:ComponentName} = () => {\n  return (\n    <div>\n      ${0}\n    </div>\n  );\n};\n\nexport default ${1:ComponentName};",
      description: 'Creates a React functional component',
      language: 'javascript'
    },
    {
      id: '2',
      name: 'Console Log',
      prefix: 'clg',
      body: 'console.log(${1:object});',
      description: 'Console log',
      language: 'javascript'
    },
    {
      id: '3',
      name: 'UseEffect Hook',
      prefix: 'uef',
      body: 'useEffect(() => {\n  ${1}\n}, [${2:dependencies}]);',
      description: 'React useEffect hook',
      language: 'javascript'
    }
  ]);

  const [newSnippet, setNewSnippet] = useState({ name: '', prefix: '', body: '', description: '', language: 'javascript' });
  const [isAddingSnippet, setIsAddingSnippet] = useState(false);

  const insertSnippet = (body: string) => {
    // Basic snippet insertion (removing placeholders for now)
    const cleanBody = body.replace(/\$\{\d+(:[^}]*)?\}|\$0/g, '');
    setCode(prev => prev + '\n' + cleanBody);
    setActiveTab('editor');
  };

  const addSnippet = () => {
    if (!newSnippet.name || !newSnippet.prefix || !newSnippet.body) return;
    const snippet: Snippet = {
      id: Math.random().toString(36).substring(7),
      ...newSnippet
    };
    setSnippets(prev => [...prev, snippet]);
    setNewSnippet({ name: '', prefix: '', body: '', description: '', language: 'javascript' });
    setIsAddingSnippet(false);
  };

  const deleteSnippet = (id: string) => {
    setSnippets(prev => prev.filter(s => s.id !== id));
  };

  // Message editing functions
  const startEditing = (index: number, content: string) => {
    setEditingMessageId(index);
    setEditContent(content);
  };

  const saveEdit = (index: number) => {
    const updatedMessages = [...messages];
    updatedMessages[index].content = editContent;
    setMessages(updatedMessages);
    setEditingMessageId(null);
    setEditContent('');
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalOutput]);

  useEffect(() => {
    if (settings.autoSave && code) {
      const timer = setTimeout(() => {
        const timestamp = new Date().toLocaleTimeString();
        setTerminalOutput(prev => [...prev, '[' + timestamp + '] Auto-saved src/App.tsx']);
        if (settings.formatOnSave) {
          setTerminalOutput(prev => [...prev, '[' + timestamp + '] Formatted src/App.tsx']);
        }
      }, settings.autoSaveDelay);
      return () => clearTimeout(timer);
    }
  }, [code, settings.autoSave, settings.autoSaveDelay, settings.formatOnSave]);

  const runGitCommand = (command: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalOutput(prev => [...prev, '[' + timestamp + '] > git ' + command]);

    if (vscode) {
      postMessage({ type: 'runGitCommand', command });
      return;
    }

    setTimeout(() => {
      let output: string[] = [];
      switch (command) {
        case 'status': {
          const staged = gitFiles.filter(f => f.staged);
          const unstaged = gitFiles.filter(f => !f.staged);

          output = [
            'On branch version-update',
            'Your branch is up to date with \'origin/version-update\'.',
            '',
          ];

          if (staged.length > 0) {
            output.push('Changes to be committed:');
            output.push('  (use "git restore --staged <file>..." to unstage)');
            staged.forEach(f => {
              const statusMap = { 'M': 'modified', 'A': 'new file', 'D': 'deleted', 'U': 'untracked' };
              output.push('        ' + statusMap[f.status] + ':   ' + f.name);
            });
            output.push('');
          }

          if (unstaged.length > 0) {
            output.push('Changes not staged for commit:');
            output.push('  (use "git add <file>..." to update what will be committed)');
            output.push('  (use "git restore <file>..." to discard changes in working directory)');
            unstaged.forEach(f => {
              const statusMap = { 'M': 'modified', 'A': 'new file', 'D': 'deleted', 'U': 'untracked' };
              output.push('        ' + statusMap[f.status] + ':   ' + f.name);
            });
          }

          if (staged.length === 0 && unstaged.length === 0) {
            output.push('nothing to commit, working tree clean');
          }
          break;
        }
        case 'pull':
          output = [
            'remote: Enumerating objects: 5, done.',
            'remote: Counting objects: 100% (5/5), done.',
            'remote: Compressing objects: 100% (3/3), done.',
            'remote: Total 3 (delta 2), reused 0 (delta 0), pack-reused 0',
            'Unpacking objects: 100% (3/3), 284 bytes | 284.00 KiB/s, done.',
            'From github.com:broxlab/ai-assistant',
            '   a1b2c3d..e5f6g7h  version-update -> origin/version-update',
            'Already up to date.'
          ];
          break;
        case 'push':
          output = [
            'Enumerating objects: 9, done.',
            'Counting objects: 100% (9/9), done.',
            'Delta compression using up to 8 threads',
            'Compressing objects: 100% (5/5), done.',
            'Writing objects: 100% (5/5), 624 bytes | 624.00 KiB/s, done.',
            'Total 5 (delta 3), reused 0 (delta 0), pack-reused 0',
            'To github.com:broxlab/ai-assistant.git',
            '   e5f6g7h..i9j0k1l  version-update -> version-update'
          ];
          break;
        case 'commit': {
          const stagedFiles = gitFiles.filter(f => f.staged);
          if (stagedFiles.length === 0) {
            output = ['nothing to commit (create/copy files and use "git add" to track)'];
          } else if (!commitMessage.trim()) {
            output = ['error: switch `m\' requires a value', 'fatal: no commit message specified.'];
          } else {
            output = [
              '[version-update ' + Math.random().toString(36).substring(7) + '] ' + commitMessage,
              ' ' + stagedFiles.length + ' files changed, 45 insertions(+), 12 deletions(-)'
            ];
            setGitFiles(prev => prev.filter(f => !f.staged));
            setCommitMessage('');
          }
          break;
        }
        default:
          output = ['Unknown git command: ' + command];
      }

      setTerminalOutput(prev => [...prev, ...output]);
    }, 500);
  };

  const toggleStage = (name: string) => {
    setGitFiles(prev => prev.map(f => f.name === name ? { ...f, staged: !f.staged } : f));
  };

  const toggleAllStage = (staged: boolean) => {
    setGitFiles(prev => prev.map(f => ({ ...f, staged })));
  };

  const postMessage = (message: any) => {
    if (vscode) {
      vscode.postMessage(message);
    }
  };

  const addAssistantMessage = (content: string) => {
    setMessages(prev => [...prev, { role: 'assistant', content, timestamp: new Date() }]);
  };

  const handleAgentUpdate = (update: any) => {
    if (!update) return;

    switch (update.type) {
      case 'progress': {
        // Update AI status based on the progress message
        const text = update.text.toLowerCase();
        if (text.includes('thinking')) setAiStatus('thinking');
        else if (text.includes('reading') || text.includes('read_file')) setAiStatus('reading');
        else if (text.includes('editing') || text.includes('edit')) setAiStatus('editing');
        else if (text.includes('searching') || text.includes('search')) setAiStatus('searching');
        else if (text.includes('running tool') || text.includes('executing')) setAiStatus('executing');
        addAssistantMessage(update.text);
        break;
      }
      case 'text':
        addAssistantMessage(update.text);
        setIsTyping(false);
        setAiStatus('idle');
        break;
      case 'stream':
        // Handle streaming response
        setAiStatus('thinking');
        break;
      case 'tool':
        addAssistantMessage('```\n[' + update.name + ']\n' + update.result + '\n```');
        setAiStatus('idle');
        break;
      case 'tokenUsage':
        setTokenUsage(update);
        break;
      case 'error':
        addAssistantMessage('Error: ' + update.text);
        setIsTyping(false);
        setAiStatus('idle');
        break;
      default:
        break;
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || !data.type) return;

      switch (data.type) {
        case 'settingsLoaded':
          setSettings(prev => ({
            ...prev,
            aiModel: data.model || prev.aiModel,
            provider: (data.model && (data.model as string).startsWith('ollama/')) ? 'Ollama' : 'OpenRouter',
            localModelUrl: data.localModelUrl || prev.localModelUrl,
            apiKey: data.apiKey || prev.apiKey,
            customPrompt: data.customPrompt ?? prev.customPrompt,
            approvalMode: data.approvalMode ?? prev.approvalMode,
          }));

          if (Array.isArray(data.history)) {
            setMessages(data.history.map((m: any) => ({
              role: m.role,
              content: m.content,
              timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
            })));
          }
          break;
        case 'modelsLoaded':
          setModels(data.models || []);
          break;
        case 'addMessage':
          if (data.message) {
            setMessages(prev => [...prev, {
              role: data.message.role,
              content: data.message.content,
              timestamp: new Date()
            }]);
          }
          break;
        case 'agentUpdate':
          handleAgentUpdate(data.update);
          break;
        case 'workspaceFiles':
          setWorkspaceFiles(data.files || []);
          break;
        case 'gitStatus':
          setGitStatus(data.status);
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    if (vscode) {
      vscode.postMessage({ type: 'webviewLoaded' });
    }

    return () => window.removeEventListener('message', handleMessage);
  }, [vscode]);

  // Fetch available models (OpenRouter + Ollama) when opening Settings tab
  useEffect(() => {
    if (vscode && activeTab === 'settings') {
      postMessage({ type: 'fetchModels' });
    }
  }, [activeTab, vscode]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = { role: 'user', content: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    if (vscode) {
      postMessage({
        type: 'sendMessage',
        text: input,
        history: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        model: settings.aiModel
      });
      return;
    }

    const response = await generateAIResponse(input);
    const assistantMsg: Message = {
      role: 'assistant',
      content: response || "I'm sorry, I couldn't process that.",
      timestamp: new Date()
    };
    setMessages(prev => [...prev, assistantMsg]);
    setIsTyping(false);
  };

  const handleSaveSettings = () => {
    postMessage({
      type: 'saveSettings',
      apiKey: settings.apiKey,
      model: settings.aiModel,
      customPrompt: settings.customPrompt,
      approvalMode: settings.approvalMode
    });
  };

  const runCode = () => {
    setTerminalOutput(prev => [...prev, '> Running code...', 'Hello, BroxLab!', 'Process exited with code 0.']);
  };

  return (
    <div className={cn(
      "flex h-screen w-full font-sans overflow-hidden transition-colors duration-300",
      settings.theme === 'dark' ? "bg-[#0d0d0d] text-zinc-300" :
        settings.theme === 'light' ? "bg-white text-zinc-800" :
          "bg-black text-yellow-400"
    )}>
      {/* Activity Bar */}
      <div className={cn(
        "w-12 flex flex-col items-center py-2 border-r shrink-0",
        settings.theme === 'dark' ? "bg-[#1a1a1a] border-zinc-800" :
          settings.theme === 'light' ? "bg-zinc-100 border-zinc-200" :
            "bg-black border-yellow-400"
      )}>
        <ActivityBarItem icon={Layout} active={activeTab === 'editor'} onClick={() => setActiveTab('editor')} label="Editor" />
        <ActivityBarItem icon={Files} active={activeTab === 'explorer'} onClick={() => setActiveTab('explorer')} label="Explorer" />
        <ActivityBarItem icon={GitBranch} active={activeTab === 'git'} onClick={() => setActiveTab('git')} label="Source Control" />
        <ActivityBarItem icon={MessageSquare} active={activeTab === 'ai'} onClick={() => setActiveTab('ai')} label="BroxLab AI" />
        <ActivityBarItem icon={Code} active={activeTab === 'snippets'} onClick={() => setActiveTab('snippets')} label="Snippets" />
        <div className="mt-auto">
          <ActivityBarItem icon={Settings} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="Settings" />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab Header */}
        <div className="h-9 bg-[#1a1a1a] flex items-center border-b border-zinc-800 shrink-0 overflow-x-auto no-scrollbar">
          <TabButton icon={Layout} active={activeTab === 'editor'} onClick={() => setActiveTab('editor')} label="Editor" />
          <TabButton icon={Files} active={activeTab === 'explorer'} onClick={() => setActiveTab('explorer')} label="Explorer" />
          <TabButton icon={GitBranch} active={activeTab === 'git'} onClick={() => setActiveTab('git')} label="Source Control" />
          <TabButton icon={MessageSquare} active={activeTab === 'ai'} onClick={() => setActiveTab('ai')} label="BroxLab AI" />
          <TabButton icon={Code} active={activeTab === 'snippets'} onClick={() => setActiveTab('snippets')} label="Snippets" />
          <TabButton icon={Settings} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="Settings" />
        </div>

        {/* Dynamic Content */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col">
              <div className={cn(
                "flex-1 relative overflow-hidden flex",
                settings.theme === 'dark' ? "bg-[#1e1e1e]" :
                  settings.theme === 'light' ? "bg-white" :
                    "bg-black"
              )}>
                {settings.lineNumbers && (
                  <div className={cn(
                    "w-12 border-r flex flex-col items-end pr-2 pt-4 font-mono text-xs select-none",
                    settings.theme === 'dark' ? "bg-[#1e1e1e] border-zinc-800 text-zinc-600" :
                      settings.theme === 'light' ? "bg-zinc-50 border-zinc-200 text-zinc-400" :
                        "bg-black border-yellow-400 text-yellow-600"
                  )}>
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                )}
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{
                    fontSize: settings.fontSize + 'px',
                    fontFamily: settings.fontFamily === 'JetBrains Mono' ? 'var(--font-mono)' : 'var(--font-sans)',
                    tabSize: settings.tabSize,
                    MozTabSize: settings.tabSize
                  }}
                  className={cn(
                    "flex-1 bg-transparent p-4 outline-none resize-none",
                    settings.theme === 'dark' ? "text-zinc-300" :
                      settings.theme === 'light' ? "text-zinc-800" :
                        "text-yellow-400",
                    settings.wordWrap ? "whitespace-pre-wrap" : "whitespace-pre overflow-x-auto",
                    settings.fontFamily === 'JetBrains Mono' ? "font-mono" : "font-sans"
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Tab') {
                      const target = e.target as HTMLTextAreaElement;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      const value = target.value;

                      // Get the word before the cursor
                      const lastSpace = value.lastIndexOf(' ', start - 1);
                      const lastNewline = value.lastIndexOf('\n', start - 1);
                      const wordStart = Math.max(lastSpace, lastNewline) + 1;
                      const prefix = value.substring(wordStart, start);

                      const snippet = snippets.find(s => s.prefix === prefix);
                      if (snippet) {
                        e.preventDefault();
                        const cleanBody = snippet.body.replace(/\$\{\d+(:[^}]*)?\}|\$0/g, '');
                        const newValue = value.substring(0, wordStart) + cleanBody + value.substring(start);
                        setCode(newValue);

                        // Set cursor position after insertion (async to wait for state update)
                        setTimeout(() => {
                          target.selectionStart = target.selectionEnd = wordStart + cleanBody.length;
                        }, 0);
                      } else {
                        // Regular tab insertion
                        e.preventDefault();
                        const spaces = ' '.repeat(settings.tabSize);
                        const newValue = value.substring(0, start) + spaces + value.substring(end);
                        setCode(newValue);
                        setTimeout(() => {
                          target.selectionStart = target.selectionEnd = start + spaces.length;
                        }, 0);
                      }
                    }
                  }}
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          {activeTab === 'explorer' && (
            <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
              <div className="flex items-center gap-2 mb-6">
                <Files className="text-blue-400" size={24} />
                <h2 className="text-xl font-bold">Explorer</h2>
              </div>
              <div className="bg-zinc-800/20 border border-zinc-800 rounded-xl p-4">
                <div className="flex items-center gap-1 text-xs font-bold text-zinc-500 uppercase p-1">
                  <ChevronDown size={14} />
                  BROXLAB-AI-ASSISTANT
                </div>
                <div className="pl-4 space-y-2 mt-2">
                  <div className="flex items-center gap-2 text-sm p-2 hover:bg-zinc-800 rounded cursor-pointer text-zinc-300">
                    <ChevronDown size={14} className="text-zinc-500" />
                    src
                  </div>
                  <div className="pl-6 space-y-1">
                    <div className="flex items-center gap-2 text-sm p-2 bg-zinc-800 rounded cursor-pointer text-white">
                      <Files size={16} className="text-blue-400" />
                      App.tsx
                    </div>
                    <div className="flex items-center gap-2 text-sm p-2 hover:bg-zinc-800 rounded cursor-pointer text-zinc-400">
                      <Files size={16} className="text-zinc-500" />
                      main.tsx
                    </div>
                    <div className="flex items-center gap-2 text-sm p-2 hover:bg-zinc-800 rounded cursor-pointer text-zinc-400">
                      <Files size={16} className="text-zinc-500" />
                      index.css
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'git' && (
            <div className="flex-1 p-6 max-w-4xl mx-auto w-full overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <GitBranch className="text-emerald-500" size={24} />
                  <h2 className="text-xl font-bold">Source Control</h2>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleAllStage(true)}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
                  >
                    <Plus size={14} />
                    Stage All
                  </button>
                  <button
                    onClick={() => toggleAllStage(false)}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
                  >
                    <X size={14} />
                    Unstage All
                  </button>
                  <div className="w-px h-8 bg-zinc-800 mx-1" />
                  <button onClick={() => runGitCommand('status')} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 transition-colors" title="Refresh Status">
                    <RefreshCw size={18} />
                  </button>
                  <button onClick={() => runGitCommand('pull')} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 transition-colors" title="Pull Changes">
                    <ArrowDown size={18} />
                  </button>
                  <button onClick={() => runGitCommand('push')} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 transition-colors" title="Push Changes">
                    <ArrowUp size={18} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-4">
                  <div className="bg-zinc-800/20 border border-zinc-800 rounded-xl p-4 space-y-4">
                    <textarea
                      placeholder="Commit Message (Ctrl+Enter to commit)"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          runGitCommand('commit');
                        }
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 outline-none focus:border-blue-500 resize-none h-32"
                    />
                    <button
                      onClick={() => runGitCommand('commit')}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      Commit to version-update
                    </button>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-6">
                  <div className="bg-zinc-800/20 border border-zinc-800 rounded-xl p-4 space-y-4">
                    {/* Staged Changes */}
                    {gitFiles.filter(f => f.staged).length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-3 group">
                          <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Staged Changes</h3>
                          <div className="flex items-center gap-2">
                            <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full text-[10px]">{gitFiles.filter(f => f.staged).length}</span>
                            <button
                              onClick={() => toggleAllStage(false)}
                              className="p-1 hover:bg-zinc-800 rounded text-zinc-500 transition-colors"
                              title="Unstage All"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {gitFiles.filter(f => f.staged).map(file => (
                            <div key={file.name} className="flex items-center justify-between text-sm p-2 hover:bg-zinc-800 rounded-lg group cursor-pointer transition-colors">
                              <span className="flex items-center gap-3 truncate">
                                <Files size={16} className="text-zinc-500 shrink-0" />
                                <span className="truncate font-medium">{file.name}</span>
                              </span>
                              <div className="flex items-center gap-3">
                                <span className={cn(
                                  "font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-900",
                                  file.status === 'M' ? "text-emerald-500" : "text-blue-500"
                                )}>{file.status}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleStage(file.name); }}
                                  className="p-1 hover:bg-zinc-700 rounded text-zinc-500 opacity-0 group-hover:opacity-100 transition-all"
                                  title="Unstage"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Changes (Unstaged) */}
                    <div>
                      <div className="flex items-center justify-between mb-3 group">
                        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Changes</h3>
                        <div className="flex items-center gap-2">
                          <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full text-[10px]">{gitFiles.filter(f => !f.staged).length}</span>
                          <button
                            onClick={() => toggleAllStage(true)}
                            className="p-1 hover:bg-zinc-800 rounded text-zinc-500 transition-colors"
                            title="Stage All"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {gitFiles.filter(f => !f.staged).map(file => (
                          <div key={file.name} className="flex items-center justify-between text-sm p-2 hover:bg-zinc-800 rounded-lg group cursor-pointer transition-colors">
                            <span className="flex items-center gap-3 truncate">
                              <Files size={16} className="text-zinc-500 shrink-0" />
                              <span className="truncate font-medium">{file.name}</span>
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={cn(
                                "font-mono text-xs px-1.5 py-0.5 rounded bg-zinc-900",
                                file.status === 'M' ? "text-emerald-500" : "text-blue-500"
                              )}>{file.status}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleStage(file.name); }}
                                className="p-1 hover:bg-zinc-700 rounded text-zinc-500 opacity-0 group-hover:opacity-100 transition-all"
                                title="Stage"
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                        {gitFiles.filter(f => !f.staged).length === 0 && (
                          <div className="text-sm text-zinc-600 italic p-2">No changes detected</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="flex-1 flex flex-col max-w-5xl mx-auto w-full overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.map((msg, i) => (
                  <div key={i} className={cn(
                    "flex flex-col max-w-[85%]",
                    msg.role === 'user' ? "ml-auto items-end" : "items-start"
                  )}>
                    <div className={cn(
                      "p-4 rounded-2xl text-sm leading-relaxed shadow-sm",
                      msg.role === 'user'
                        ? "bg-blue-600 text-white rounded-tr-none"
                        : settings.theme === 'dark' ? "bg-zinc-800/50 text-zinc-300 rounded-tl-none border border-zinc-700" :
                          settings.theme === 'light' ? "bg-white text-zinc-800 rounded-tl-none border border-zinc-200" :
                            "bg-black text-yellow-400 rounded-tl-none border border-yellow-400"
                    )}>
                      <div className="markdown-body">
                        <Markdown>{msg.content}</Markdown>
                      </div>
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-2 font-medium">
                      {msg.role === 'assistant' ? 'BroxLab AI' : 'You'} • {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
                {isTyping && (
                  <div className="flex items-center gap-3 text-zinc-500 text-xs bg-zinc-800/20 w-fit px-4 py-2 rounded-full border border-zinc-800">
                    <RefreshCw size={12} className="animate-spin text-blue-500" />
                    BroxLab AI is reasoning...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-6 border-t border-zinc-800 bg-[#151515]/50 backdrop-blur-md">
                <div className="relative group">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Ask BroxLab AI to refactor, explain, or generate code..."
                    className={cn(
                      "w-full border rounded-xl p-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all resize-none min-h-25",
                      settings.theme === 'dark' ? "bg-zinc-900 border-zinc-800 text-zinc-200" :
                        settings.theme === 'light' ? "bg-white border-zinc-200 text-zinc-800 shadow-inner" :
                          "bg-black border-yellow-400 text-yellow-400"
                    )}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || isTyping}
                    className="absolute right-3 bottom-3 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white rounded-lg transition-all shadow-lg hover:scale-105 active:scale-95"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <div className="flex items-center justify-center gap-6 mt-4">
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                    <Zap size={12} className="text-yellow-500" />
                    Fast Reasoning
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-wider font-bold">
                    <Sparkles size={12} className="text-purple-500" />
                    Context Aware
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'snippets' && (
            <div className="flex-1 p-6 max-w-5xl mx-auto w-full overflow-y-auto">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <Code className="text-blue-400" size={24} />
                  <h2 className="text-xl font-bold">Code Snippets</h2>
                </div>
                <button
                  onClick={() => setIsAddingSnippet(!isAddingSnippet)}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2"
                >
                  <Plus size={18} />
                  {isAddingSnippet ? 'Cancel' : 'New Snippet'}
                </button>
              </div>

              {isAddingSnippet && (
                <div className="bg-zinc-800/20 border border-zinc-800 rounded-2xl p-6 mb-8 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase font-bold mb-1.5 block">Name</label>
                      <input
                        type="text"
                        value={newSnippet.name}
                        onChange={(e) => setNewSnippet(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g. React Hook"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase font-bold mb-1.5 block">Prefix (Keyword)</label>
                      <input
                        type="text"
                        value={newSnippet.prefix}
                        onChange={(e) => setNewSnippet(prev => ({ ...prev, prefix: e.target.value }))}
                        placeholder="e.g. useh"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase font-bold mb-1.5 block">Language</label>
                      <select
                        value={newSnippet.language}
                        onChange={(e) => setNewSnippet(prev => ({ ...prev, language: e.target.value }))}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                      >
                        <option value="javascript">JavaScript</option>
                        <option value="typescript">TypeScript</option>
                        <option value="jsx">JSX</option>
                        <option value="tsx">TSX</option>
                        <option value="css">CSS</option>
                        <option value="json">JSON</option>
                        <option value="markdown">Markdown</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase font-bold mb-1.5 block">Description</label>
                      <input
                        type="text"
                        value={newSnippet.description}
                        onChange={(e) => setNewSnippet(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Brief description..."
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 uppercase font-bold mb-1.5 block">Body</label>
                    <div className="w-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden min-h-32">
                      <Editor
                        value={newSnippet.body}
                        onValueChange={code => setNewSnippet(prev => ({ ...prev, body: code }))}
                        highlight={code => {
                          const lang = Prism.languages[newSnippet.language] || Prism.languages.javascript;
                          return Prism.highlight(code, lang, newSnippet.language);
                        }}
                        padding={12}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 13,
                          minHeight: '128px',
                        }}
                        className="outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={addSnippet}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-sm font-semibold transition-all"
                  >
                    Save Snippet
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {snippets.map(snippet => (
                  <div key={snippet.id} className="bg-zinc-800/20 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-all group">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-zinc-200">{snippet.name}</h3>
                        <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Prefix: {snippet.prefix}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => insertSnippet(snippet.body)}
                          className="p-1.5 hover:bg-zinc-800 rounded text-blue-400"
                          title="Insert into Editor"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => deleteSnippet(snippet.id)}
                          className="p-1.5 hover:bg-zinc-800 rounded text-red-400"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 mb-4 h-8">{snippet.description}</p>
                    <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800/50 overflow-hidden">
                      <pre className="text-[10px] font-mono text-zinc-500 overflow-x-auto">
                        <code
                          dangerouslySetInnerHTML={{
                            __html: Prism.highlight(snippet.body, Prism.languages[snippet.language] || Prism.languages.javascript, snippet.language)
                          }}
                        />
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="flex-1 p-6 max-w-4xl mx-auto w-full overflow-y-auto">
              <div className="flex items-center gap-2 mb-8">
                <Settings className="text-zinc-400" size={24} />
                <h2 className="text-xl font-bold">Settings</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <section className="bg-zinc-800/20 border border-zinc-800 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Appearance</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">Theme</label>
                        <select
                          value={settings.theme}
                          onChange={(e) => setSettings(prev => ({ ...prev, theme: e.target.value as any }))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        >
                          <option value="dark">Dark (Default)</option>
                          <option value="light">Light</option>
                          <option value="high-contrast">High Contrast</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Editor</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-400">Font Size</label>
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            value={settings.fontSize}
                            onChange={(e) => setSettings(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                            className="w-16 bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-sm text-zinc-300 text-center outline-none focus:border-blue-500"
                          />
                          <span className="text-xs text-zinc-500">px</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">Font Family</label>
                        <select
                          value={settings.fontFamily}
                          onChange={(e) => setSettings(prev => ({ ...prev, fontFamily: e.target.value as any }))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        >
                          <option value="JetBrains Mono">JetBrains Mono (Mono)</option>
                          <option value="Inter">Inter (Sans)</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between p-2 hover:bg-zinc-800/40 rounded-lg transition-colors">
                        <label className="text-sm text-zinc-400">Line Numbers</label>
                        <input
                          type="checkbox"
                          checked={settings.lineNumbers}
                          onChange={(e) => setSettings(prev => ({ ...prev, lineNumbers: e.target.checked }))}
                          className="w-5 h-5 rounded-md border-zinc-800 bg-zinc-900 text-blue-600 focus:ring-blue-500/50"
                        />
                      </div>
                      <div className="flex items-center justify-between p-2 hover:bg-zinc-800/40 rounded-lg transition-colors">
                        <label className="text-sm text-zinc-400">Word Wrap</label>
                        <input
                          type="checkbox"
                          checked={settings.wordWrap}
                          onChange={(e) => setSettings(prev => ({ ...prev, wordWrap: e.target.checked }))}
                          className="w-5 h-5 rounded-md border-zinc-800 bg-zinc-900 text-blue-600 focus:ring-blue-500/50"
                        />
                      </div>
                      <div className="pt-4 border-t border-zinc-800/50">
                        <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-4">Behavior</h4>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-2 hover:bg-zinc-800/40 rounded-lg transition-colors">
                            <div className="flex flex-col">
                              <label className="text-sm text-zinc-400">Auto Save</label>
                              <span className="text-[10px] text-zinc-600">Automatically save changes</span>
                            </div>
                            <input
                              type="checkbox"
                              checked={settings.autoSave}
                              onChange={(e) => setSettings(prev => ({ ...prev, autoSave: e.target.checked }))}
                              className="w-5 h-5 rounded-md border-zinc-800 bg-zinc-900 text-blue-600 focus:ring-blue-500/50"
                            />
                          </div>
                          {settings.autoSave && (
                            <div className="flex items-center justify-between px-2">
                              <label className="text-xs text-zinc-500">Save Delay (ms)</label>
                              <input
                                type="number"
                                value={settings.autoSaveDelay}
                                onChange={(e) => setSettings(prev => ({ ...prev, autoSaveDelay: parseInt(e.target.value) }))}
                                className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-300 text-center outline-none focus:border-blue-500"
                              />
                            </div>
                          )}
                          <div className="flex items-center justify-between p-2 hover:bg-zinc-800/40 rounded-lg transition-colors">
                            <label className="text-sm text-zinc-400">Format on Save</label>
                            <input
                              type="checkbox"
                              checked={settings.formatOnSave}
                              onChange={(e) => setSettings(prev => ({ ...prev, formatOnSave: e.target.checked }))}
                              className="w-5 h-5 rounded-md border-zinc-800 bg-zinc-900 text-blue-600 focus:ring-blue-500/50"
                            />
                          </div>
                          <div className="flex items-center justify-between px-2">
                            <label className="text-xs text-zinc-500">Tab Size</label>
                            <select
                              value={settings.tabSize}
                              onChange={(e) => setSettings(prev => ({ ...prev, tabSize: parseInt(e.target.value) }))}
                              className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-xs text-zinc-300 outline-none focus:border-blue-500"
                            >
                              <option value={2}>2</option>
                              <option value={4}>4</option>
                              <option value={8}>8</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="pt-4 border-t border-zinc-800/50">
                        <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-4">Keybindings</h4>
                        <select
                          value={settings.keybindings}
                          onChange={(e) => setSettings(prev => ({ ...prev, keybindings: e.target.value as any }))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        >
                          <option value="standard">Standard (VS Code)</option>
                          <option value="vim">Vim</option>
                          <option value="emacs">Emacs</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="bg-zinc-800/20 border border-zinc-800 rounded-2xl p-6 space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">AI & API</h3>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">Provider</label>
                        <select
                          value={settings.provider}
                          onChange={(e) => {
                            const provider = e.target.value as any;
                            const filtered = models.filter((m: any) => m.provider === provider);
                            setSettings(prev => ({
                              ...prev,
                              provider,
                              aiModel: filtered.length > 0 ? (filtered[0].id || filtered[0].name) : prev.aiModel
                            }));
                          }}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        >
                          <option value="OpenRouter">OpenRouter</option>
                          <option value="Ollama">Ollama</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">Model</label>
                        <select
                          value={settings.aiModel}
                          onChange={(e) => {
                            const modelId = e.target.value;
                            setSettings(prev => ({
                              ...prev,
                              aiModel: modelId,
                              provider: modelId.startsWith('ollama/') ? 'Ollama' : 'OpenRouter'
                            }));
                          }}
                          disabled={!hasProviderModels}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        >
                          {hasProviderModels ? (
                            providerModels.map((m: any) => (
                              <option key={m.id || m.name} value={m.id || m.name}>
                                {m.name || m.id}
                              </option>
                            ))
                          ) : (
                            <option value="" disabled>
                              No models found for {settings.provider}
                            </option>
                          )}
                        </select>

                        {settings.provider === 'Ollama' && !hasProviderModels && (
                          <div className="mt-2 text-xs text-yellow-200 bg-yellow-900/20 border border-yellow-500/30 rounded-md p-2">
                            <p className="mb-2">No Ollama models could be fetched. Is Ollama running at <code className="font-mono">{localModelBaseUrl}</code>?</p>
                            <button
                              onClick={() => postMessage({ type: 'fetchModels' })}
                              className="text-xs font-semibold text-blue-200 hover:text-white"
                            >
                              Retry
                            </button>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">Custom Prompt</label>
                        <textarea
                          value={settings.customPrompt}
                          onChange={(e) => setSettings(prev => ({ ...prev, customPrompt: e.target.value }))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500 h-24 resize-none"
                          placeholder="Enter a prompt template (use ${userInput} as placeholder)"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">Approval Mode</label>
                        <select
                          value={settings.approvalMode}
                          onChange={(e) => setSettings(prev => ({ ...prev, approvalMode: e.target.value as any }))}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        >
                          <option value="Auto Approve">Auto Approve</option>
                          <option value="Ask Every Time">Ask Every Time</option>
                          <option value="Ask Once Per Session">Ask Once Per Session</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm text-zinc-400 block mb-2">API Key Override</label>
                        <input
                          type="password"
                          value={settings.apiKey}
                          onChange={(e) => setSettings(prev => ({ ...prev, apiKey: e.target.value }))}
                          placeholder="Enter key..."
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-300 outline-none focus:border-blue-500"
                        />
                        <p className="text-[10px] text-zinc-600 mt-2 leading-relaxed">
                          By default, BroxLab uses your AI Studio credentials. Provide a key here to override.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4">
                    <div className="bg-blue-600/10 border border-blue-600/20 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-blue-400 mb-2">
                        <Sparkles size={16} />
                        <span className="text-xs font-bold uppercase tracking-wider">Pro Tip</span>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Use Gemini 3.1 Pro for complex architectural reasoning and Gemini 3 Flash for quick refactors and explanations.
                      </p>
                    </div>
                    <button
                      onClick={handleSaveSettings}
                      className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg text-sm font-semibold transition-colors"
                    >
                      Save Settings
                    </button>
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Panel (Terminal) */}
        <div className={cn(
          "h-1/3 border-t flex flex-col",
          settings.theme === 'dark' ? "bg-[#151515] border-zinc-800" :
            settings.theme === 'light' ? "bg-zinc-50 border-zinc-200" :
              "bg-black border-yellow-400"
        )}>
          <div className={cn(
            "h-9 flex items-center px-4 gap-6 border-b shrink-0",
            settings.theme === 'dark' ? "border-zinc-800" :
              settings.theme === 'light' ? "border-zinc-200" :
                "border-yellow-400"
          )}>
            <button className={cn(
              "text-[10px] font-bold uppercase tracking-widest h-full",
              settings.theme === 'dark' ? "text-white border-b border-white" :
                settings.theme === 'light' ? "text-zinc-800 border-b border-zinc-800" :
                  "text-yellow-400 border-b border-yellow-400"
            )}>Terminal</button>
            <button className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 h-full">Output</button>
            <button className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 h-full">Debug Console</button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={runCode}
                className="p-1 hover:bg-zinc-800 rounded text-emerald-500 transition-colors"
                title="Run Code"
              >
                <Play size={14} fill="currentColor" />
              </button>
              <button onClick={() => setTerminalOutput(['BroxLab Terminal v1.0.0'])} className="p-1 hover:bg-zinc-800 rounded text-zinc-500">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-1">
            {terminalOutput.map((line, i) => (
              <div key={i} className={cn(
                line.startsWith('>') ? "text-blue-400" :
                  line.includes('Error') ? "text-red-400" :
                    settings.theme === 'light' ? "text-zinc-600" : "text-zinc-400"
              )}>
                {line}
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-emerald-500">➜</span>
              <span className="text-blue-400">broxlab-ai</span>
              <span className="text-zinc-500">git:(</span>
              <span className="text-red-400">version-update</span>
              <span className="text-zinc-500">)</span>
              <input
                type="text"
                className={cn(
                  "bg-transparent outline-none flex-1",
                  settings.theme === 'light' ? "text-zinc-800" : "text-zinc-300"
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    setTerminalOutput(prev => [...prev, '> ' + val + ' ']);
                    (e.target as HTMLInputElement).value = '';
                    if (val === 'help') {
                      setTerminalOutput(prev => [...prev, 'Available commands: help, clear, run, git-status, ai-plan']);
                    } else if (val === 'git-status') {
                      runGitCommand('status');
                    } else if (val === 'clear') {
                      setTerminalOutput(['BroxLab Terminal v1.0.0']);
                    }
                  }
                }}
              />
            </div>
            <div ref={terminalEndRef} />
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="fixed bottom-0 left-0 right-0 h-6 bg-blue-600 text-white flex items-center px-3 text-[10px] gap-4 z-50">
        <div className="flex items-center gap-1 hover:bg-blue-700 h-full px-2 cursor-pointer">
          <GitBranch size={12} />
          <span>version-update*</span>
        </div>
        <div className="flex items-center gap-1 hover:bg-blue-700 h-full px-2 cursor-pointer">
          <RefreshCw size={12} />
          <span>0</span>
          <AlertCircle size={12} />
          <span>0</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="hover:bg-blue-700 h-full px-2 cursor-pointer">UTF-8</div>
          <div className="hover:bg-blue-700 h-full px-2 cursor-pointer">TypeScript JSX</div>
          <div className="flex items-center gap-1 hover:bg-blue-700 h-full px-2 cursor-pointer">
            <Sparkles size={12} />
            <span>AI Ready</span>
          </div>
        </div>
      </div>
    </div>
  );
}

