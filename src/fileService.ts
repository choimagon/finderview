import * as vscode from "vscode";
import * as path from "node:path";
import { realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { visibleNames } from "./visibility";
import { Entry, Metadata } from "./messageTypes";
const execute = promisify(execFile);
export class FileService {
  async validate(value: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.parse(value, true);
    if (
      uri.path.split("/").some((segment) => segment === ".." || segment === ".")
    )
      throw new Error("상대 경로 세그먼트는 허용하지 않습니다.");
    if (uri.query || uri.fragment)
      throw new Error("쿼리 또는 fragment가 있는 경로는 지원하지 않습니다.");
    const roots = vscode.workspace.workspaceFolders ?? [];
    const contains = (root: string, target: string) =>
      target === root ||
      target.startsWith(root.endsWith("/") ? root : root + "/");
    const root = roots.find(
      (r) =>
        r.uri.scheme === uri.scheme &&
        r.uri.authority === uri.authority &&
        contains(r.uri.path, uri.path),
    );
    if (!root)
      throw new Error("워크스페이스 외부 경로에는 접근할 수 없습니다.");
    if (uri.scheme === "file") {
      const [base, target] = await Promise.all([
        realpath(root.uri.fsPath),
        realpath(uri.fsPath),
      ]);
      const relative = path.relative(base, target);
      if (
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      )
        throw new Error("워크스페이스 외부를 가리키는 심볼릭 링크입니다.");
    } else {
      // Remote providers cannot guarantee a symlink's resolved boundary.
      const relative = uri.path
        .slice(root.uri.path.length)
        .split("/")
        .filter(Boolean);
      let cursor = root.uri;
      for (const segment of relative) {
        cursor = vscode.Uri.joinPath(cursor, segment);
        if (
          (await vscode.workspace.fs.stat(cursor)).type &
          vscode.FileType.SymbolicLink
        )
          throw new Error(
            "원격 심볼릭 링크는 안전한 경계 검증을 지원하지 않습니다.",
          );
      }
    }
    return uri;
  }
  async list(
    value: string,
    showHidden = false,
    foldersFirst = true,
  ): Promise<Entry[]> {
    const uri = await this.validate(value);
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const visible = await visibleNames(uri, entries);
    const result = await Promise.all(
      entries
        .filter(([name]) => visible.has(name) && (showHidden || !name.startsWith(".")))
        .map(async ([name, type]) => {
          const child = vscode.Uri.joinPath(uri, name);
          if (type & vscode.FileType.SymbolicLink) {
            try {
              type = (
                await vscode.workspace.fs.stat(
                  await this.validate(child.toString()),
                )
              ).type;
            } catch {
              /* Show unavailable links; selection reports the error. */
            }
          }
          return {
            uri: child.toString(),
            name,
            directory: !!(type & vscode.FileType.Directory),
            extension: path.extname(name).slice(1).toLowerCase(),
          };
        }),
    );
    return result.sort(
      (a, b) =>
        (foldersFirst ? Number(b.directory) - Number(a.directory) : 0) ||
        a.name.localeCompare(b.name, "ko", {
          numeric: true,
          sensitivity: "base",
        }),
    );
  }
  async metadata(value: string): Promise<Metadata> {
    const uri = await this.validate(value);
    const stat = await vscode.workspace.fs.stat(uri);
    return {
      name: path.posix.basename(uri.path),
      extension: path.posix.extname(uri.path).slice(1),
      size: stat.size,
      path: uri.scheme === "file" ? uri.fsPath : uri.toString(),
    };
  }
  async external(value: string): Promise<void> {
    const uri = await this.validate(value);
    if (uri.scheme !== "file" || vscode.env.remoteName)
      throw new Error("외부 앱 실행은 로컬 파일 워크스페이스에서 지원합니다.");
    if (!vscode.workspace.isTrusted)
      throw new Error(
        "외부 앱 실행에는 신뢰할 수 있는 워크스페이스가 필요합니다.",
      );
    if (process.platform === "darwin")
      await execute("/usr/bin/open", [uri.fsPath]);
    else if (process.platform === "linux")
      await execute("xdg-open", [uri.fsPath]);
    else if (process.platform === "win32")
      await execute("rundll32.exe", [
        "url.dll,FileProtocolHandler",
        uri.fsPath,
      ]);
    else throw new Error("현재 플랫폼에서 외부 앱 실행을 지원하지 않습니다.");
  }
  async open(value: string): Promise<void> {
    const uri = await this.validate(value);
    try {
      await vscode.commands.executeCommand("vscode.open", uri);
    } catch {
      const action = await vscode.window.showWarningMessage(
        "VS Code에서 열 수 없습니다. 설치된 뷰어를 확인하거나 외부 앱으로 여세요.",
        "외부 앱으로 열기",
      );
      if (action) await this.external(value);
    }
  }
}
