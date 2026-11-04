import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { FileService } from "./fileService";
import { ExplorerState, ClientMessage, Column } from "./messageTypes";
export class ExplorerProvider implements vscode.Disposable {
  readonly files = new FileService();
  state: ExplorerState = {
    type: "state",
    roots: [],
    root: "",
    columns: [],
    showHidden: true,
    foldersFirst: true,
    busy: false,
  };
  private disposables: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private watchers: vscode.Disposable[] = [];
  private revision = 0;
  private disposed = false;
  private initialLocation?: vscode.Uri;
  constructor(
    private panel: vscode.WebviewPanel,
    private extensionUri: vscode.Uri,
    initialLocation?: vscode.Uri,
  ) {
    this.initialLocation = initialLocation;
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m) => {
        void this.receive(m);
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("files.exclude") || event.affectsConfiguration("explorer.excludeGitIgnore")) void this.refresh();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.watch();
        void this.refresh();
      }),
    );
    this.watch();
    this.disposables.push(panel.onDidDispose(() => this.dispose()));
  }
  private watch() {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    for (const root of vscode.workspace.workspaceFolders ?? []) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(root, "**/*"),
      );
      const schedule = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          void this.refresh();
        }, 180);
      };
      this.watchers.push(
        watcher,
        watcher.onDidCreate(schedule),
        watcher.onDidDelete(schedule),
        watcher.onDidChange(schedule),
      );
    }
  }
  async initialize() {
    const webview = this.panel.webview;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    const html = Buffer.from(
      await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(media, "index.html"),
      ),
    ).toString("utf8");
    const values: Record<string, string> = {
      cspSource: webview.cspSource,
      nonce: randomBytes(24).toString("hex"),
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(media, "explorer.js"))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(media, "explorer.css"))
        .toString(),
    };
    webview.html = html.replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => values[key] ?? "",
    );
  }
  private emit() {
    if (!this.disposed) void this.panel.webview.postMessage(this.state);
  }
  async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object" || !("type" in raw)) return;
    const message = raw as ClientMessage;
    try {
      switch (message.type) {
        case "ready": {
          const location = this.initialLocation;
          this.initialLocation = undefined;
          if (location) await this.revealLocation(location);
          else await this.refresh();
          break;
        }
        case "refresh":
          await this.refresh();
          break;
        case "root": {
          if (!this.state.roots.some((r) => r.uri === message.uri))
            throw new Error("유효한 루트를 선택하세요.");
          this.state.root = message.uri;
          this.state.columns = [];
          this.state.metadata = undefined;
          await this.refresh();
          break;
        }
        case "options":
          if (
            typeof message.showHidden !== "boolean" ||
            typeof message.foldersFirst !== "boolean"
          )
            return;
          this.state.showHidden = message.showHidden;
          this.state.foldersFirst = message.foldersFirst;
          await this.refresh();
          break;
        case "select":
          await this.select(message.uri, message.column);
          break;
        case "open":
        case "external":
        case "copy":
        case "reveal": {
          if (typeof message.uri !== "string") return;
          const uri = await this.files.validate(message.uri);
          if (message.type === "open") await this.files.open(message.uri);
          else if (message.type === "external")
            await this.files.external(message.uri);
          else if (message.type === "copy")
            await vscode.env.clipboard.writeText(
              uri.scheme === "file" ? uri.fsPath : uri.toString(),
            );
          else {
            if (uri.scheme !== "file" || vscode.env.remoteName)
              throw new Error("Finder에서 표시는 로컬 파일만 지원합니다.");
            await vscode.commands.executeCommand("revealFileInOS", uri);
          }
          break;
        }
      }
    } catch (error) {
      this.state.busy = false;
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit();
    }
  }
  async select(uri: string, index: number) {
    if (!Number.isInteger(index) || index < 0) return;
    const column = this.state.columns[index];
    const entry = column?.entries.find((e) => e.uri === uri);
    if (!entry) return;
    const token = ++this.revision;
    this.state.columns = this.state.columns.slice(0, index + 1);
    column.selected = uri;
    this.state.error = undefined;
    this.state.metadata = undefined;
    this.state.busy = true;
    this.emit();
    try {
      const metadata = await this.files.metadata(uri);
      const child = entry.directory
        ? await this.load(uri, entry.name)
        : undefined;
      if (token !== this.revision) return;
      this.state.metadata = metadata;
      if (child) this.state.columns.push(child);
    } catch (error) {
      if (token === this.revision)
        this.state.error =
          error instanceof Error ? error.message : String(error);
    } finally {
      if (token === this.revision) {
        this.state.busy = false;
        this.emit();
      }
    }
  }
  async revealLocation(location: vscode.Uri) {
    const root = vscode.workspace.getWorkspaceFolder(location);
    if (!root) { await this.refresh(); return; }
    const token = ++this.revision;
    this.state.busy = true;
    this.state.error = undefined;
    this.emit();
    try {
      const target = await this.files.validate(location.toString());
      const relative = target.path.slice(root.uri.path.length).split("/").filter(Boolean);
      if (relative.some(segment => segment.startsWith("."))) this.state.showHidden = true;
      const columns: Column[] = [];
      let uri = root.uri;
      let name = root.name;
      let metadata;
      for (let index = 0; ; index++) {
        const column = await this.load(uri.toString(), name);
        columns.push(column);
        if (index >= relative.length) break;
        const entry = column.entries.find(item => item.name === relative[index]);
        if (!entry) throw new Error("현재 파일의 경로를 찾을 수 없습니다.");
        column.selected = entry.uri;
        metadata = await this.files.metadata(entry.uri);
        if (!entry.directory) break;
        uri = vscode.Uri.parse(entry.uri);
        name = entry.name;
      }
      if (token !== this.revision) return;
      this.state.roots = (vscode.workspace.workspaceFolders ?? []).map(folder => ({uri: folder.uri.toString(), name: folder.name}));
      this.state.root = root.uri.toString();
      this.state.columns = columns;
      this.state.metadata = metadata;
    } catch (error) {
      if (token === this.revision) this.state.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (token === this.revision) { this.state.busy = false; this.emit(); }
    }
  }
  private async load(uri: string, name: string): Promise<Column> {
    return {
      uri,
      name,
      entries: await this.files.list(
        uri,
        this.state.showHidden,
        this.state.foldersFirst,
      ),
    };
  }
  async refresh() {
    const token = ++this.revision;
    this.state.roots = (vscode.workspace.workspaceFolders ?? []).map((r) => ({
      uri: r.uri.toString(),
      name: r.name,
    }));
    if (!this.state.roots.some((r) => r.uri === this.state.root)) {
      this.state.root = this.state.roots[0]?.uri ?? "";
      this.state.columns = [];
    }
    this.state.busy = true;
    this.state.error = undefined;
    this.emit();
    const previous = this.state.columns;
    const columns: Column[] = [];
    let metadata;
    try {
      if (this.state.root) {
        let uri = this.state.root;
        let name = this.state.roots.find((r) => r.uri === uri)!.name;
        for (let index = 0; ; index++) {
          let column: Column;
          try {
            column = await this.load(uri, name);
          } catch (error) {
            if (!index)
              columns.push({ uri, name, entries: [], error: String(error) });
            break;
          }
          columns.push(column);
          const entry = column.entries.find(
            (e) => e.uri === previous[index]?.selected,
          );
          if (!entry) break;
          column.selected = entry.uri;
          try {
            metadata = await this.files.metadata(entry.uri);
          } catch {
            column.selected = undefined;
            break;
          }
          if (!entry.directory) break;
          uri = entry.uri;
          name = entry.name;
        }
      }
      if (token === this.revision) {
        this.state.columns = columns;
        this.state.metadata = metadata;
      }
    } finally {
      if (token === this.revision) {
        this.state.busy = false;
        this.emit();
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.revision;
    clearTimeout(this.timer);
    for (const item of [...this.disposables, ...this.watchers]) item.dispose();
  }
}
