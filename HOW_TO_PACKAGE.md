# How to Package Your VS Code Extension (.vsix)

To share or install your BroxLab AI extension in VS Code, you must compile it into a `.vsix` package file. Here is the step-by-step guide to doing so:

## Prerequisites

You need the `vsce` (Visual Studio Code Extension) CLI tool to package the extension. Make sure you have it installed globally or use `npx vsce`.

## Step 1: Create Required Files

Before packaging, you need to create the following files in the root directory:

1. **README.md**: A markdown file with extension documentation
2. **LICENSE**: A license file (e.g., MIT, Apache 2.0)

## Step 2: Update `package.json` Metadata

The `package.json` file already has the required properties:
- **Publisher Name**: `"broxlab"` ✅ (already set)
- **Repository** (Optional): Add `"repository"` field if you have a repo
- **Icon** (Optional): Add `"icon"` field with path to 128x128px PNG

Example additions to package.json:
```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/broxlab-ai"
  },
  "icon": "icon.png"
}
```

## Step 3: Build the Extension

Open your terminal in the `broxlab-ai\` project folder and run:

```bash
# 1. Install dependencies if you haven't already
npm install

# 2. Build the webview UI
npm run build-webview

# 3. Compile TypeScript
npm run compile

# 3.1 (Optional) Verify TypeScript linting
npm run lint

# 3.2 (Optional) Auto-version bump (recommended before packaging)
# This updates package.json version and creates a git tag.
# Use patch/minor/major depending on the release type.
npm version patch

# 4. Package the extension using vsce
npx vsce package

---

## Full Release Workflow (Recommended)
For a full release process that versions, builds, packages, and pushes tags:

```bash
# 1. Pick release level: patch/minor/major
npm version patch

# 2. Build the webview UI
npm run build-webview

# 3. Compile TypeScript
npm run compile

# 4. Package the extension
npx vsce package

# 5. Push release tags to GitHub
git push --follow-tags
```
```
## Step 4: Find the `.vsix` File

After running the command successfully, you will see a new file generated in your folder named:
`broxlab-ai-0.0.1.vsix`

## Step 5: Install the Extension

You can now install this file on any VS Code installation:

**Method 1: via the VS Code UI**
1. Open the **Extensions** view in VS Code (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Click the `...` (Views and More Actions) button in the top right of the Extensions panel.
3. Select **Install from VSIX...**
4. Locate and select your `broxlab-ai-0.0.1.vsix` file.

**Method 2: via Command Line**
```bash
code --install-extension broxlab-ai-0.0.1.vsix
```

---

## Troubleshooting

- **Missing README.md**: vsce requires a README.md file in the root directory
- **Missing LICENSE**: Add a LICENSE file to avoid warnings
- **Webview not loading**: Make sure to run `npm run build-webview` before packaging
- **TypeScript errors**: Run `npm run compile` first to check for errors

---

🎉 **That's it!** The BroxLab AI extension is now fully installed and can be shared with others.
