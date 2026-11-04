import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { FileService } from "./fileService";
import { FileOperations } from "./fileOperations";
import {
  ExplorerState,
  ClientMessage,
  Column,
  OperationMessage,
} from "./messageTypes";
export class ExplorerProvider implements vscode.Disposable {
  readonly files = new FileService();
  readonly operations = new FileOperations(this.files);
  private operationQueue: Promise<void> = Promise.resolve();
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
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("files.exclude") ||
          event.affectsConfiguration("explorer.excludeGitIgnore")
        )
          void this.refresh();
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
          if (this.state.operationBusy) {
            schedule();
            return;
          }
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
    if (message.type === "operation") {
      this.operationQueue = this.operationQueue.then(() =>
        this.runOperation(message),
      );
      return this.operationQueue;
    }
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
  private async runOperation(message: OperationMessage) {
    if (this.disposed || typeof message.requestId !== "string") return;
    const reply: {
      type: string;
      requestId: string;
      ok: boolean;
      uploadId?: string;
      count?: number;
      error?: string;
    } = { type: "operationResult", requestId: message.requestId, ok: false };
    const chunk = message.action === "upload-chunk";
    if (!chunk) {
      this.state.operationBusy = true;
      this.state.error = undefined;
      this.emit();
    }
    try {
      switch (message.action) {
        case "transfer":
          if (
            typeof message.target !== "string" ||
            (message.copy !== undefined && typeof message.copy !== "boolean")
          )
            throw new Error("대상 폴더가 올바르지 않습니다.");
          reply.count = await this.operations.transfer(
            message.uris!,
            message.target,
            message.copy === true,
          );
          break;
        case "move": {
          if (!Array.isArray(message.uris) || !message.uris.length)
            throw new Error("이동할 항목을 선택하세요.");
          for (const uri of message.uris) await this.files.validate(uri);
          const target = await vscode.window.showOpenDialog({
            title: "선택한 항목을 이동할 워크스페이스 폴더",
            openLabel: "여기로 이동",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri: vscode.Uri.parse(this.state.root),
          });
          reply.count = target?.[0]
            ? await this.operations.transfer(message.uris, target[0].toString())
            : 0;
          break;
        }
        case "rename":
          if (
            !Array.isArray(message.uris) ||
            message.uris.length !== 1 ||
            typeof message.uris[0] !== "string"
          )
            throw new Error("이름을 바꿀 항목 한 개를 선택하세요.");
          reply.count = await this.operations.rename(message.uris[0]);
          break;
        case "trash":
          reply.count = await this.operations.trash(message.uris!);
          break;
        case "add":
          if (typeof message.target !== "string")
            throw new Error("파일을 넣을 폴더를 선택하세요.");
          reply.count = await this.operations.addFromPicker(message.target);
          break;
        case "upload-start":
          if (typeof message.target !== "string")
            throw new Error("파일을 넣을 폴더를 선택하세요.");
          reply.uploadId = await this.operations.startUpload(message.target);
          break;
        case "upload-chunk":
          if (
            typeof message.uploadId !== "string" ||
            (message.directory !== undefined &&
              typeof message.directory !== "boolean")
          )
            throw new Error("파일 전송 정보가 올바르지 않습니다.");
          await this.operations.upload(
            message.uploadId,
            message.relativePath!,
            message.data,
            message.offset,
            message.directory,
          );
          break;
        case "upload-finish":
          if (typeof message.uploadId !== "string")
            throw new Error("파일 전송 정보가 올바르지 않습니다.");
          reply.count = await this.operations.finishUpload(message.uploadId);
          break;
        case "upload-cancel":
          if (typeof message.uploadId !== "string")
            throw new Error("파일 전송 정보가 올바르지 않습니다.");
          await this.operations.cancelUpload(message.uploadId);
          break;
        default:
          throw new Error("지원하지 않는 파일 작업입니다.");
      }
      reply.ok = true;
      if (
        [
          "transfer",
          "move",
          "trash",
          "rename",
          "add",
          "upload-finish",
        ].includes(message.action)
      )
        await this.refresh();
    } catch (error) {
      reply.error = error instanceof Error ? error.message : String(error);
      if (typeof message.uploadId === "string")
        await this.operations.cancelUpload(message.uploadId).catch(() => {});
      await this.refresh();
      this.state.error = reply.error;
    } finally {
      if (
        !reply.ok ||
        !["upload-start", "upload-chunk"].includes(message.action)
      )
        this.state.operationBusy = false;
      if (!chunk || !reply.ok) this.emit();
      if (!this.disposed) await this.panel.webview.postMessage(reply);
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
    if (!root) {
      await this.refresh();
      return;
    }
    const token = ++this.revision;
    this.state.busy = true;
    this.state.error = undefined;
    this.emit();
    try {
      const target = await this.files.validate(location.toString());
      const relative = target.path
        .slice(root.uri.path.length)
        .split("/")
        .filter(Boolean);
      if (relative.some((segment) => segment.startsWith(".")))
        this.state.showHidden = true;
      const columns: Column[] = [];
      let uri = root.uri;
      let name = root.name;
      let metadata;
      for (let index = 0; ; index++) {
        const column = await this.load(uri.toString(), name);
        columns.push(column);
        if (index >= relative.length) break;
        const entry = column.entries.find(
          (item) => item.name === relative[index],
        );
        if (!entry) throw new Error("현재 파일의 경로를 찾을 수 없습니다.");
        column.selected = entry.uri;
        metadata = await this.files.metadata(entry.uri);
        if (!entry.directory) break;
        uri = vscode.Uri.parse(entry.uri);
        name = entry.name;
      }
      if (token !== this.revision) return;
      this.state.roots = (vscode.workspace.workspaceFolders ?? []).map(
        (folder) => ({ uri: folder.uri.toString(), name: folder.name }),
      );
      this.state.root = root.uri.toString();
      this.state.columns = columns;
      this.state.metadata = metadata;
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
    void this.operationQueue.finally(() => this.operations.dispose());
    for (const item of [...this.disposables, ...this.watchers]) item.dispose();
  }
}
