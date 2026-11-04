import * as vscode from "vscode";
import { minimatch } from "minimatch";
import ignore, { Ignore } from "ignore";
import * as path from "node:path";
import { execFile } from "node:child_process";

// Visibility follows Explorer settings, not macOS Finder's UF_HIDDEN flag.
export async function visibleNames(
  directory: vscode.Uri,
  entries: [string, vscode.FileType][],
): Promise<Set<string>> {
  const root = vscode.workspace.getWorkspaceFolder(directory);
  if (!root) return new Set(entries.map(([name]) => name));
  const rules = vscode.workspace.getConfiguration("files", directory)
    .get<Record<string, boolean | { when: string }>>("exclude", {});
  const siblings = new Set(entries.map(([name]) => name));
  const relative = directory.path.slice(root.uri.path.length).replace(/^\/+/, "");
  const candidates = entries.filter(([name]) => {
    const item = relative ? `${relative}/${name}` : name;
    return !Object.entries(rules).some(([pattern, rule]) => {
      if (!rule || !minimatch(item, pattern, {dot:true, nonegate:true, nocomment:true, nocase:process.platform === "win32"})) return false;
      if (rule === true) return true;
      if (typeof rule.when !== "string") return false;
      const basename = name.slice(0, name.length - path.posix.extname(name).length);
      return siblings.has(rule.when.replace(/\$\(basename\)/g, basename));
    });
  });
  if (!vscode.workspace.getConfiguration("explorer", directory).get<boolean>("excludeGitIgnore", false)) {
    return new Set(candidates.map(([name]) => name));
  }
  // Git handles repository ancestors, nested ignore files, negation, global
  // excludes and .git/info/exclude. NUL framing preserves arbitrary filenames.
  if (directory.scheme === "file") {
    const ignored = await gitIgnored(directory, candidates);
    if (ignored) return new Set(candidates.filter(([name]) => !ignored.has(vscode.Uri.joinPath(directory, name).fsPath)).map(([name]) => name));
  }
  // Virtual providers (and directories without Git) use scoped .gitignore files.
  const scopes: {base: vscode.Uri; matcher: Ignore}[] = [];
  const parts = relative.split("/").filter(Boolean);
  let base = root.uri;
  for (let index=0; index<=parts.length; index++) {
    try {
      const content = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(base, ".gitignore"));
      scopes.push({base, matcher:ignore({ignorecase:process.platform === "win32"}).add(Buffer.from(content).toString("utf8"))});
    } catch (error) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== "FileNotFound") throw error;
    }
    if (index < parts.length) base = vscode.Uri.joinPath(base, parts[index]);
  }
  return new Set(candidates.filter(([name,type]) => {
    const child = vscode.Uri.joinPath(directory,name);
    let excluded = false;
    for (const scope of scopes) {
      const candidate = child.path.slice(scope.base.path.length).replace(/^\/+/, "") + (type & vscode.FileType.Directory ? "/" : "");
      const match = scope.matcher.test(candidate);
      if (match.ignored) excluded = true;
      else if (match.unignored) excluded = false;
    }
    return !excluded;
  }).map(([name]) => name));
}

function gitIgnored(directory: vscode.Uri, entries: [string, vscode.FileType][]): Promise<Set<string> | undefined> {
  if (!entries.length) return Promise.resolve(new Set());
  return new Promise(resolve => {
    const child = execFile("git", ["-C", directory.fsPath, "check-ignore", "--no-index", "-z", "--stdin"], {encoding:"utf8", maxBuffer:16*1024*1024, timeout:5000}, (error, stdout) => {
      if (error && error.code !== 1) { resolve(undefined); return; }
      resolve(new Set(stdout.split("\0").filter(Boolean)));
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(entries.map(([name]) => vscode.Uri.joinPath(directory,name).fsPath).join("\0") + "\0");
  });
}
