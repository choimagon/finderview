import * as vscode from "vscode";
import { ExplorerProvider } from "./explorerProvider";
export function activate(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | undefined;
  let provider: ExplorerProvider | undefined;
  context.subscriptions.push(
    vscode.commands.registerCommand("columnExplorer.open", async (resource?: vscode.Uri) => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      const location = resource instanceof vscode.Uri ? resource
        : input && typeof input === "object" && "uri" in input && input.uri instanceof vscode.Uri ? input.uri
        : undefined;
      if (panel) {
        panel.reveal();
        if (location && vscode.workspace.getWorkspaceFolder(location)) await provider?.revealLocation(location);
        return;
      }
      panel = vscode.window.createWebviewPanel(
        "columnExplorer",
        "FinderView",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
          retainContextWhenHidden: true,
        },
      );
      panel.iconPath = {
        light: vscode.Uri.joinPath(context.extensionUri, "media", "finderview-light.svg"),
        dark: vscode.Uri.joinPath(context.extensionUri, "media", "finderview-dark.svg"),
      };
      provider = new ExplorerProvider(panel, context.extensionUri, location);
      context.subscriptions.push(
        provider,
        panel.onDidDispose(() => {
          panel = undefined;
          provider = undefined;
        }),
      );
      await provider.initialize();
    }),
  );
}
