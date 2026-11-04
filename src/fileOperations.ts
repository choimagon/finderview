import * as vscode from "vscode";
import * as path from "node:path";
import * as os from "node:os";
import {
  mkdtemp,
  mkdir,
  appendFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { FileService } from "./fileService";

export type ConflictChoice = "overwrite" | "rename" | "skip" | "cancel";
export interface OperationDialogs {
  conflict(name: string): Promise<ConflictChoice>;
  name(current: string): Promise<string | undefined>;
}
const defaultDialogs: OperationDialogs = {
  async conflict(name) {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "덮어쓰기",
          description: "기존 항목을 휴지통에 보관한 뒤 교체",
          value: "overwrite" as const,
        },
        {
          label: "다른 이름으로 저장",
          description: "기존 항목 유지",
          value: "rename" as const,
        },
        {
          label: "건너뛰기",
          description: "이 항목만 처리하지 않음",
          value: "skip" as const,
        },
        {
          label: "취소",
          description: "이번 작업 중단",
          value: "cancel" as const,
        },
      ],
      {
        title: `같은 이름이 이미 있습니다: ${name}`,
        placeHolder: "처리 방법을 선택하세요",
        ignoreFocusOut: true,
      },
    );
    return choice?.value ?? "cancel";
  },
  async name(current) {
    return vscode.window.showInputBox({
      title: "이름 변경",
      prompt: "파일 또는 폴더의 새 이름",
      value: current,
      ignoreFocusOut: true,
      validateInput: (value) =>
        validName(value)
          ? undefined
          : "폴더 경로가 아닌 파일/폴더 이름만 입력하세요.",
    });
  },
};
function validName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    (process.platform !== "win32" || !/[<>:"|?*]/.test(value))
  );
}
type Upload = {
  directory: string;
  target: string;
  files: Map<string, number>;
  total: number;
};
export class FileOperations implements vscode.Disposable {
  private uploads = new Map<string, Upload>();
  constructor(
    private files: FileService,
    private confirm: (message: string) => Promise<boolean> = async (message) =>
      (await vscode.window.showWarningMessage(
        message,
        { modal: true },
        "휴지통으로 이동",
      )) === "휴지통으로 이동",
    private dialogs: OperationDialogs = defaultDialogs,
  ) {}

  private trusted() {
    if (!vscode.workspace.isTrusted)
      throw new Error(
        "파일 변경에는 신뢰할 수 있는 워크스페이스가 필요합니다.",
      );
  }
  private async directory(value: string) {
    this.trusted();
    const uri = await this.files.validate(value);
    if (
      !((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory)
    )
      throw new Error("대상 폴더를 선택하세요.");
    return uri;
  }
  private async sources(values: string[]) {
    this.trusted();
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 10000 ||
      values.some((value) => typeof value !== "string")
    )
      throw new Error("파일 또는 폴더를 선택하세요.");
    const sources = await Promise.all(
      [...new Set(values)].map((value) => this.files.validate(value)),
    );
    for (const source of sources) {
      if (
        (vscode.workspace.workspaceFolders ?? []).some(
          (root) => root.uri.toString() === source.toString(),
        )
      )
        throw new Error("워크스페이스 루트는 이동하거나 삭제할 수 없습니다.");
    }
    return sources.filter(
      (source) =>
        !sources.some(
          (parent) =>
            parent !== source &&
            parent.scheme === source.scheme &&
            parent.authority === source.authority &&
            source.path.startsWith(parent.path.replace(/\/$/, "") + "/"),
        ),
    );
  }
  private async absent(uri: vscode.Uri) {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      )
        return;
      throw error;
    }
    throw new Error(
      `같은 이름이 이미 있습니다: ${path.posix.basename(uri.path)}. 덮어쓰지 않았습니다.`,
    );
  }
  async transfer(values: string[], target: string, copy = false) {
    const sources = await this.sources(values);
    const directory = await this.directory(target);
    return this.transferInto(sources, directory, copy);
  }
  async addFromPicker(target: string) {
    const directory = await this.directory(target);
    const sources = await vscode.window.showOpenDialog({
      title: "FinderView에 복사할 파일 선택",
      openLabel: "파일 추가",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
    });
    if (!sources?.length) return 0;
    return this.transferInto(sources, directory, true);
  }
  private protectRoot(uri: vscode.Uri) {
    if (
      (vscode.workspace.workspaceFolders ?? []).some(
        (root) => root.uri.toString() === uri.toString(),
      )
    )
      throw new Error("워크스페이스 루트는 변경할 수 없습니다.");
  }
  private async existing(
    uri: vscode.Uri,
  ): Promise<vscode.FileStat | undefined> {
    try {
      return await vscode.workspace.fs.stat(uri);
    } catch (error) {
      if (
        error instanceof vscode.FileSystemError &&
        error.code === "FileNotFound"
      )
        return undefined;
      throw error;
    }
  }
  private async resolveDestination(
    source: vscode.Uri,
    destination: vscode.Uri,
    names: Set<string>,
  ) {
    for (let attempts = 0; attempts < 100; attempts++) {
      this.protectRoot(destination);
      const name = path.posix.basename(destination.path).normalize("NFC");
      const key = process.platform === "linux" ? name : name.toLowerCase();
      const existing = await this.existing(destination);
      if (!existing && !names.has(key)) {
        names.add(key);
        return { source, destination, existing: undefined };
      }
      const choice = await this.dialogs.conflict(name);
      if (choice === "cancel") return { cancel: true } as const;
      if (choice === "skip") return undefined;
      if (choice === "overwrite") {
        if (names.has(key))
          throw new Error(
            "같은 작업에서 대상 이름을 중복 사용할 수 없습니다. 다른 이름을 선택하세요.",
          );
        await this.files.validate(destination.toString());
        names.add(key);
        return { source, destination, existing };
      }
      const newName = await this.dialogs.name(
        path.posix.basename(destination.path),
      );
      if (newName === undefined) return { cancel: true } as const;
      if (!validName(newName))
        throw new Error("유효하지 않은 파일/폴더 이름입니다.");
      destination = vscode.Uri.joinPath(
        vscode.Uri.joinPath(destination, ".."),
        newName,
      );
    }
    throw new Error("이름 충돌을 해결하지 못했습니다.");
  }
  private async noOverlap(source: vscode.Uri, destination: vscode.Uri) {
    if (
      source.scheme !== destination.scheme ||
      source.authority !== destination.authority
    )
      return;
    const paths = [[source.path, destination.path]];
    if (source.scheme === "file" && (await this.existing(destination)))
      paths.push(
        await Promise.all([
          realpath(source.fsPath),
          realpath(destination.fsPath),
        ]),
      );
    for (const [from, to] of paths) {
      const left =
        process.platform === "linux"
          ? from.normalize("NFC")
          : from.normalize("NFC").toLowerCase();
      const right =
        process.platform === "linux"
          ? to.normalize("NFC")
          : to.normalize("NFC").toLowerCase();
      if (left === right || left.startsWith(right.replace(/\/$/, "") + "/"))
        throw new Error(
          "자기 자신 또는 원본을 포함하는 상위 폴더를 덮어쓸 수 없습니다.",
        );
    }
  }
  private async transferInto(
    sources: readonly vscode.Uri[],
    directory: vscode.Uri,
    copy: boolean,
  ) {
    const plan: {
      source: vscode.Uri;
      destination: vscode.Uri;
      existing?: vscode.FileStat;
    }[] = [];
    const names = new Set<string>();
    for (const source of sources) {
      const destination = vscode.Uri.joinPath(
        directory,
        path.posix.basename(source.path),
      );
      if (source.toString() === destination.toString()) continue;
      if (
        source.scheme === directory.scheme &&
        source.authority === directory.authority &&
        directory.path.startsWith(source.path.replace(/\/$/, "") + "/")
      )
        throw new Error("폴더를 자기 하위 폴더로 옮기거나 복사할 수 없습니다.");
      if (
        source.scheme === "file" &&
        directory.scheme === "file" &&
        (await vscode.workspace.fs.stat(source)).type &
          vscode.FileType.Directory
      ) {
        const [base, target] = await Promise.all([
          realpath(source.fsPath),
          realpath(directory.fsPath),
        ]);
        const relative = path.relative(base, target);
        if (
          !relative ||
          (relative !== ".." &&
            !relative.startsWith(".." + path.sep) &&
            !path.isAbsolute(relative))
        )
          throw new Error(
            "폴더를 자기 자신 또는 하위 폴더로 옮길 수 없습니다.",
          );
      }
      const resolved = await this.resolveDestination(
        source,
        destination,
        names,
      );
      if (resolved && "cancel" in resolved) return 0;
      if (resolved) {
        await this.noOverlap(source, resolved.destination);
        plan.push(resolved);
      }
    }
    for (const item of plan)
      for (const source of sources)
        await this.noOverlap(source, item.destination);
    let completed = 0;
    try {
      for (const item of plan) {
        await this.directory(directory.toString());
        if (!copy) await this.files.validate(item.source.toString());
        await this.replaceExisting(item.destination, item.existing);
        if (copy)
          await vscode.workspace.fs.copy(item.source, item.destination, {
            overwrite: false,
          });
        else await this.renameResource(item.source, item.destination);
        completed++;
      }
    } catch (error) {
      throw new Error(
        `${completed}개 완료 후 중단했습니다. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return completed;
  }
  private async renameResource(source: vscode.Uri, destination: vscode.Uri) {
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(source, destination, {
      overwrite: false,
      ignoreIfExists: false,
    });
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error("VS Code가 파일 이동/이름 변경을 완료하지 못했습니다.");
  }
  private async replaceExisting(
    destination: vscode.Uri,
    expected?: vscode.FileStat,
  ) {
    if (!expected) {
      await this.absent(destination);
      return;
    }
    this.protectRoot(destination);
    await this.files.validate(destination.toString());
    const current = await vscode.workspace.fs.stat(destination);
    if (
      current.type !== expected.type ||
      current.size !== expected.size ||
      current.mtime !== expected.mtime ||
      current.ctime !== expected.ctime
    )
      throw new Error(
        "덮어쓰기 확인 후 대상이 변경되었습니다. 다시 시도하세요.",
      );
    // Never silently delete permanently when the trash provider is unavailable.
    await vscode.workspace.fs.delete(destination, {
      recursive: true,
      useTrash: true,
    });
  }
  async rename(value: string) {
    const [source] = await this.sources([value]);
    const name = await this.dialogs.name(path.posix.basename(source.path));
    if (name === undefined) return 0;
    if (!validName(name))
      throw new Error("유효하지 않은 파일/폴더 이름입니다.");
    const parent = vscode.Uri.joinPath(source, "..");
    const destination = vscode.Uri.joinPath(parent, name);
    if (source.toString() === destination.toString()) return 0;
    if (source.scheme === "file" && (await this.existing(destination))) {
      if (
        (await realpath(source.fsPath)) === (await realpath(destination.fsPath))
      ) {
        const temporary = vscode.Uri.joinPath(
          parent,
          `.finderview-rename-${randomUUID()}`,
        );
        await this.files.validate(source.toString());
        await this.renameResource(source, temporary);
        try {
          await this.renameResource(temporary, destination);
        } catch (error) {
          await this.renameResource(temporary, source);
          throw error;
        }
        return 1;
      }
    }
    const resolved = await this.resolveDestination(
      source,
      destination,
      new Set(),
    );
    if (!resolved || "cancel" in resolved) return 0;
    await this.noOverlap(source, resolved.destination);
    await this.directory(parent.toString());
    await this.files.validate(source.toString());
    await this.replaceExisting(resolved.destination, resolved.existing);
    await this.renameResource(source, resolved.destination);
    return 1;
  }
  async trash(values: string[]) {
    const sources = await this.sources(values);
    const names = sources
      .slice(0, 5)
      .map((uri) => path.posix.basename(uri.path))
      .join("\n");
    if (
      !(await this.confirm(
        `${sources.length}개 항목을 휴지통으로 이동할까요? 폴더를 선택하면 하위 항목도 함께 이동합니다.\n\n${names}${sources.length > 5 ? "\n…" : ""}`,
      ))
    )
      return 0;
    let completed = 0;
    try {
      for (const source of sources) {
        await this.sources([source.toString()]);
        await vscode.workspace.fs.delete(source, {
          recursive: true,
          useTrash: true,
        });
        completed++;
      }
    } catch (error) {
      throw new Error(
        `${completed}개 항목을 휴지통으로 이동한 뒤 중단했습니다. 영구 삭제는 하지 않습니다. ${String(error)}`,
      );
    }
    return completed;
  }
  private relative(value: unknown) {
    if (
      typeof value !== "string" ||
      !value ||
      value.includes("\\") ||
      value.includes("\0") ||
      value.startsWith("/") ||
      value
        .split("/")
        .some(
          (part) => !part || part === "." || part === ".." || /[:]/.test(part),
        )
    )
      throw new Error("유효하지 않은 파일 경로입니다.");
    return value;
  }
  async startUpload(target: string) {
    await this.directory(target);
    if (this.uploads.size >= 4)
      throw new Error("진행 중인 파일 추가를 먼저 완료하세요.");
    const id = randomUUID();
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "finderview-import-"),
    );
    this.uploads.set(id, { directory, target, files: new Map(), total: 0 });
    return id;
  }
  async upload(
    id: string,
    relativePath: string,
    data?: string,
    offset?: number,
    directory = false,
  ) {
    this.trusted();
    const session = this.uploads.get(id);
    if (!session) throw new Error("파일 추가 세션이 만료되었습니다.");
    const relative = this.relative(relativePath);
    const destination = path.join(session.directory, ...relative.split("/"));
    if (directory) {
      await mkdir(destination, { recursive: true });
      return;
    }
    if (
      typeof data !== "string" ||
      data.length > 720000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        data,
      )
    )
      throw new Error("파일 데이터가 올바르지 않습니다.");
    const bytes = Buffer.from(data, "base64");
    const current = session.files.get(relative);
    if (offset !== (current ?? 0) || !Number.isSafeInteger(offset))
      throw new Error("파일 전송 순서가 올바르지 않습니다.");
    if (session.total + bytes.length > 1024 * 1024 * 1024)
      throw new Error("한 번에 추가할 수 있는 파일 총 크기는 1GB입니다.");
    await mkdir(path.dirname(destination), { recursive: true });
    if (current === undefined)
      await writeFile(destination, bytes, { flag: "wx" });
    else await appendFile(destination, bytes);
    session.files.set(relative, (current ?? 0) + bytes.length);
    session.total += bytes.length;
  }
  async finishUpload(id: string) {
    const session = this.uploads.get(id);
    if (!session) throw new Error("파일 추가 세션이 만료되었습니다.");
    try {
      const directory = await this.directory(session.target);
      const staged = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(session.directory),
      );
      if (!staged.length) return 0;
      return await this.transferInto(
        staged.map(([name]) =>
          vscode.Uri.file(path.join(session.directory, name)),
        ),
        directory,
        true,
      );
    } finally {
      await this.cancelUpload(id);
    }
  }
  async cancelUpload(id: string) {
    const session = this.uploads.get(id);
    this.uploads.delete(id);
    if (session) await rm(session.directory, { recursive: true, force: true });
  }
  dispose() {
    for (const id of this.uploads.keys())
      void this.cancelUpload(id).catch(() => {});
  }
}
