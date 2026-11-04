(() => {
  "use strict";
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const columns = $("columns");
  const menu = $("context");
  let state = { columns: [], roots: [] };
  let contextUri;
  let focusUri;
  let previousCount = 0;
  let selectedUris = new Set();
  let anchor;
  let localBusy = false;
  let operationSequence = 0;
  const pending = new Map();
  const dragMime = "application/x-finderview-uris";
  // Host updates replace rows between clicks. Track the URI rather than rely
  // on the browser's dblclick event, which requires the same DOM target.
  let lastClick;
  const post = (message) => vscode.postMessage(message);
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const select = (entry, column, toggle = false) => {
    focusUri = entry.uri;
    selectedUris = new Set([entry.uri]);
    anchor = { uri: entry.uri, column };
    updateSelection();
    post({ type: "select", uri: entry.uri, column, toggle });
  };
  const formatSize = (size) => {
    if (!Number.isFinite(size)) return "";
    if (size < 1024) return `${size} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = size / 1024,
      unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
  };
  function showContext(event, uri) {
    event.preventDefault();
    contextUri = uri;
    if (!selectedUris.has(uri)) selectedUris = new Set([uri]);
    updateSelection();
    menu.hidden = false;
    menu.style.left = `${Math.max(4, Math.min(event.clientX, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector("button").focus();
  }
  function render(next) {
    const active = document.activeElement;
    const hadRowFocus = active && active.classList.contains("entry");
    const scroll = [...columns.children].map(
      (column) => column.querySelector(".entries")?.scrollTop || 0,
    );
    const horizontal = columns.scrollLeft;
    const oldPath = state.columns
      .map((column) => column.selected || "")
      .join("\n");
    const newPath = next.columns
      .map((column) => column.selected || "")
      .join("\n");
    const visible = new Set(
      next.columns.flatMap((column) =>
        column.entries.map((entry) => entry.uri),
      ),
    );
    if (state.root && state.root !== next.root) {
      selectedUris.clear();
      anchor = undefined;
    }
    selectedUris = new Set([...selectedUris].filter((uri) => visible.has(uri)));
    if (
      oldPath !== newPath &&
      selectedUris.size <= 1 &&
      !localBusy &&
      !next.operationBusy
    ) {
      const current = next.columns
        .map((column) => column.selected)
        .filter(Boolean)
        .at(-1);
      if (current) selectedUris = new Set([current]);
    }
    state = next;
    $("roots").replaceChildren(
      ...next.roots.map((root) => {
        const option = node("option", "", root.name);
        option.value = root.uri;
        return option;
      }),
    );
    $("roots").value = next.root || "";
    $("roots").hidden = next.roots.length < 2;
    $("hidden").checked = !!next.showHidden;
    $("sort").value =
      next.sortBy === "modified"
        ? "modified"
        : next.foldersFirst
          ? "folders"
          : "name";
    $("activity").textContent =
      next.operationBusy || localBusy
        ? "파일 작업 중…"
        : next.busy
          ? "불러오는 중…"
          : `${next.columns.length}개 열`;
    columns.setAttribute("aria-busy", String(!!next.busy));
    $("error").hidden = !next.error;
    $("error").textContent = next.error || "";
    $("breadcrumb").textContent =
      next.columns.map((column) => column.name).join("  ›  ") || "워크스페이스";
    columns.replaceChildren();
    if (!next.roots.length) {
      const welcome = node("div", "welcome");
      welcome.append(
        node("strong", "", "탐색할 워크스페이스가 없습니다"),
        node("span", "", "VS Code에서 폴더 또는 워크스페이스를 열어 주세요."),
      );
      columns.append(welcome);
    }
    next.columns.forEach((column, index) => {
      const section = node("section", "column");
      const header = node("h2", "column-header");
      header.append(
        node("span", "", column.name),
        node("span", "count", String(column.entries.length)),
      );
      header.title = column.uri;
      const list = node("div", "entries");
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", column.name);
      list.setAttribute("aria-multiselectable", "true");
      installDropTarget(list, column.uri, column.name);
      installDropTarget(header, column.uri, column.name);
      if (!column.entries.length)
        list.append(
          node(
            "div",
            "empty",
            column.error || (next.busy ? "불러오는 중…" : "빈 폴더입니다"),
          ),
        );
      column.entries.forEach((entry) => {
        const button = node(
          "button",
          `entry${column.selected === entry.uri ? " selected" : ""}`,
        );
        button.type = "button";
        button.draggable = true;
        button.dataset.uri = entry.uri;
        button.setAttribute("role", "option");
        button.setAttribute(
          "aria-selected",
          String(column.selected === entry.uri),
        );
        button.title = entry.name;
        const extension = (
          entry.extension ||
          entry.name.split(".").slice(1).pop() ||
          ""
        )
          .replace(/^\./, "")
          .toLowerCase();
        const icon = node(
          "span",
          "icon",
          entry.directory ? "▰" : extension.slice(0, 3).toUpperCase() || "FILE",
        );
        if (entry.directory) icon.classList.add("folder");
        else if (/^[a-z0-9]+$/.test(extension)) icon.classList.add(extension);
        icon.setAttribute("aria-hidden", "true");
        button.append(icon, node("span", "filename", entry.name));
        if (entry.directory) {
          const expanded = next.columns[index + 1]?.uri === entry.uri;
          button.setAttribute("aria-expanded", String(expanded));
          button.title = `${entry.name} · 클릭: 펼치기/접기 · 외부 파일: Shift를 누른 채 여기에 놓기`;
          button.append(node("span", "arrow", expanded ? "⌄" : "›"));
        }
        button.addEventListener("click", (event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            lastClick = undefined;
            multiSelect(entry, index, event);
            return;
          }
          const now = Date.now();
          const doubleClick =
            event.detail !== 0 &&
            lastClick?.uri === entry.uri &&
            now - lastClick.time <= 500;
          lastClick =
            doubleClick || event.detail === 0
              ? undefined
              : { uri: entry.uri, time: now };
          if (doubleClick && !entry.directory)
            post({ type: "external", uri: entry.uri });
          else select(entry, index, true);
        });
        button.addEventListener("dragstart", (event) => {
          if (state.operationBusy || localBusy) {
            event.preventDefault();
            return;
          }
          lastClick = undefined;
          if (!selectedUris.has(entry.uri)) selectedUris = new Set([entry.uri]);
          updateSelection();
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(
            dragMime,
            JSON.stringify([...selectedUris]),
          );
          event.dataTransfer.setData(
            "text/uri-list",
            [...selectedUris].join("\r\n"),
          );
        });
        button.addEventListener("dragend", () => {
          lastClick = undefined;
          clearDropHighlights();
        });
        if (entry.directory) installDropTarget(button, entry.uri, entry.name);
        button.addEventListener("contextmenu", (event) =>
          showContext(event, entry.uri),
        );
        button.addEventListener("keydown", (event) =>
          handleKey(event, entry, index),
        );
        list.append(button);
      });
      section.append(header, list);
      columns.append(section);
      list.scrollTop = scroll[index] || 0;
    });
    const metadata = $("metadata");
    metadata.replaceChildren();
    if (next.metadata) {
      const meta = next.metadata;
      metadata.append(
        node("span", "meta-name", meta.name),
        node(
          "span",
          "meta-detail",
          [meta.extension || "확장자 없음", formatSize(meta.size)]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      const path = node("span", "meta-path", meta.path);
      path.title = meta.path;
      metadata.append(path);
    } else
      metadata.append(
        node("span", "hint", "폴더를 선택해 탐색하세요"),
        node(
          "span",
          "key-hint",
          "↑ ↓ 선택 · → 열기 · ← 이전 열 · Enter 파일 열기",
        ),
      );
    columns.scrollLeft = horizontal;
    if (hadRowFocus && focusUri)
      findRow(focusUri)?.focus({ preventScroll: true });
    if (next.columns.length > previousCount)
      columns.lastElementChild?.scrollIntoView({
        block: "nearest",
        inline: "end",
      });
    previousCount = next.columns.length;
    updateSelection();
  }
  function currentDirectory() {
    return state.columns.at(-1)?.uri;
  }
  function showError(error) {
    $("error").hidden = false;
    $("error").textContent =
      error instanceof Error ? error.message : String(error);
  }
  function updateSelection() {
    const busy = !!state.operationBusy || localBusy;
    columns.setAttribute("aria-busy", String(!!state.busy || busy));
    if (!busy)
      $("activity").textContent = state.busy
        ? "불러오는 중…"
        : `${state.columns.length}개 열`;
    else if (!$("activity").textContent.startsWith("파일 추가 "))
      $("activity").textContent = "파일 작업 중…";
    $("selection-count").textContent = selectedUris.size
      ? `${selectedUris.size}개 선택`
      : "";
    for (const button of menu.querySelectorAll("button")) {
      if (["add", "move", "rename", "trash"].includes(button.dataset.action))
        button.disabled = busy;
    }
    for (const row of columns.querySelectorAll(".entry")) {
      row.className = row.className.replace(/\s*multi-selected\b/g, "");
      if (selectedUris.has(row.dataset.uri))
        row.classList.add("multi-selected");
      row.setAttribute(
        "aria-selected",
        String(
          selectedUris.has(row.dataset.uri) ||
            row.classList.contains("selected"),
        ),
      );
    }
  }
  function multiSelect(entry, column, event) {
    const entries = state.columns[column].entries;
    if (!anchor || anchor.column !== column) {
      selectedUris.clear();
      anchor = { uri: entry.uri, column };
    }
    if (event.shiftKey) {
      const start = entries.findIndex((item) => item.uri === anchor.uri);
      const end = entries.findIndex((item) => item.uri === entry.uri);
      selectedUris = new Set(
        entries
          .slice(Math.min(Math.max(start, 0), end), Math.max(start, end) + 1)
          .map((item) => item.uri),
      );
    } else if (selectedUris.has(entry.uri)) selectedUris.delete(entry.uri);
    else selectedUris.add(entry.uri);
    focusUri = entry.uri;
    updateSelection();
  }
  function requestOperation(action, values = {}) {
    const requestId = `file-${Date.now()}-${++operationSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(
          new Error(
            "파일 작업 응답이 지연되고 있습니다. 작업 결과를 확인한 뒤 새로고침하세요.",
          ),
        );
      }, 600000);
      pending.set(requestId, { resolve, reject, timer });
      post({ type: "operation", requestId, action, ...values });
    });
  }
  async function perform(action, values) {
    if (state.operationBusy || localBusy) return;
    if (action !== "add" && !values.uris?.length) {
      showError("파일 또는 폴더를 선택하세요.");
      return;
    }
    localBusy = true;
    updateSelection();
    try {
      await requestOperation(action, values);
    } catch (error) {
      showError(error);
    } finally {
      localBusy = false;
      updateSelection();
    }
  }
  function clearDropHighlights() {
    for (const target of columns.querySelectorAll(".drop-target"))
      target.className = target.className.replace(/\s*drop-target\b/g, "");
  }
  function installDropTarget(element, target, name) {
    element.addEventListener("dragover", (event) => {
      if (state.operationBusy || localBusy) return;
      const types = Array.from(event.dataTransfer?.types || []);
      if (
        !types.some((type) =>
          [dragMime, "Files", "text/uri-list"].includes(type),
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = types.includes(dragMime)
        ? event.altKey || event.ctrlKey
          ? "copy"
          : "move"
        : "copy";
      clearDropHighlights();
      element.classList.add("drop-target");
      $("activity").textContent =
        `${name || state.columns.at(-1)?.name || "현재 폴더"}에 ${event.dataTransfer.dropEffect === "move" ? "이동" : "복사"}`;
    });
    element.addEventListener("dragleave", (event) => {
      if (!element.contains?.(event.relatedTarget))
        element.className = element.className.replace(/\s*drop-target\b/g, "");
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearDropHighlights();
      if (state.operationBusy || localBusy) return;
      const destination = typeof target === "function" ? target() : target;
      if (!destination) {
        showError("먼저 파일을 넣을 폴더를 여세요.");
        return;
      }
      const transfer = event.dataTransfer;
      const internal = transfer?.getData(dragMime);
      if (internal) {
        try {
          const uris = JSON.parse(internal);
          if (
            !Array.isArray(uris) ||
            uris.some((uri) => typeof uri !== "string")
          )
            throw new Error("드래그한 경로가 올바르지 않습니다.");
          void perform("transfer", {
            uris,
            target: destination,
            copy: !!(event.altKey || event.ctrlKey),
          });
        } catch (error) {
          showError(error);
        }
        return;
      }
      // Read user-provided File objects, never local filesystem paths.
      const items = Array.from(transfer?.items || []).filter(
        (item) => item.kind === "file",
      );
      const roots = [];
      const files = [];
      const fallbackFiles = Array.from(transfer?.files || []);
      // Capture each File synchronously while the drop's data store is readable.
      // Mixed files/directories must not lose files when one entry API is absent.
      items.forEach((item, index) => {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) roots.push(entry);
        else {
          const file = item.getAsFile?.() || fallbackFiles[index];
          if (file) files.push(file);
          else if (entry) roots.push(entry);
        }
      });
      if (!items.length) files.push(...fallbackFiles);
      if (roots.length || files.length) {
        void importDrop(destination, roots, files);
        return;
      }
      const uris = (transfer?.getData("text/uri-list") || "")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"));
      if (uris.length)
        void perform("transfer", { uris, target: destination, copy: true });
      else
        showError(
          "이 항목을 가져올 수 없습니다. Shift를 누른 채 놓거나 우클릭 → 파일 추가를 사용하세요.",
        );
    });
  }
  async function* walkDrop(entry, prefix = "") {
    const relativePath = prefix + entry.name;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) =>
        entry.file(resolve, reject),
      );
      yield { relativePath, file };
    } else if (entry.isDirectory) {
      yield { relativePath, directory: true };
      const reader = entry.createReader();
      while (true) {
        const entries = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const child of entries) yield* walkDrop(child, relativePath + "/");
      }
    }
  }
  function base64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }
  async function importDrop(target, roots, files) {
    if (state.operationBusy || localBusy) return;
    localBusy = true;
    updateSelection();
    let uploadId;
    try {
      const entries = [];
      let total = 0;
      const add = (entry) => {
        if (entries.length >= 10000)
          throw new Error("한 번에 추가할 수 있는 항목 수는 10,000개입니다.");
        total += entry.file?.size || 0;
        if (total > 1024 * 1024 * 1024)
          throw new Error("한 번에 추가할 수 있는 파일 총 크기는 1GB입니다.");
        entries.push(entry);
      };
      for (const root of roots)
        for await (const entry of walkDrop(root)) add(entry);
      for (const file of files) add({ relativePath: file.name, file });
      ({ uploadId } = await requestOperation("upload-start", { target }));
      let completed = 0;
      for (const entry of entries) {
        if (entry.directory)
          await requestOperation("upload-chunk", {
            uploadId,
            relativePath: entry.relativePath,
            directory: true,
          });
        else {
          const file = entry.file;
          if (!file.size)
            await requestOperation("upload-chunk", {
              uploadId,
              relativePath: entry.relativePath,
              data: "",
              offset: 0,
            });
          for (let offset = 0; offset < file.size; offset += 512 * 1024) {
            const data = base64(
              new Uint8Array(
                await file.slice(offset, offset + 512 * 1024).arrayBuffer(),
              ),
            );
            await requestOperation("upload-chunk", {
              uploadId,
              relativePath: entry.relativePath,
              data,
              offset,
            });
          }
        }
        completed++;
        $("activity").textContent = `파일 추가 ${completed}/${entries.length}`;
      }
      await requestOperation("upload-finish", { uploadId });
      uploadId = undefined;
    } catch (error) {
      if (uploadId)
        await requestOperation("upload-cancel", { uploadId }).catch(() => {});
      showError(error);
    } finally {
      localBusy = false;
      updateSelection();
    }
  }
  function findRow(uri) {
    return [...columns.querySelectorAll(".entry")].find(
      (row) => row.dataset.uri === uri,
    );
  }
  function handleKey(event, entry, index) {
    const entries = state.columns[index].entries;
    const position = entries.findIndex((item) => item.uri === entry.uri);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectedUris = new Set(entries.map((item) => item.uri));
      anchor = { uri: entry.uri, column: index };
      updateSelection();
      return;
    }
    if (
      event.key === "Delete" ||
      (event.metaKey && event.key === "Backspace")
    ) {
      event.preventDefault();
      if (!selectedUris.has(entry.uri)) selectedUris = new Set([entry.uri]);
      void perform("trash", { uris: [...selectedUris] });
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      void perform("rename", { uris: [entry.uri] });
      return;
    }
    let target;
    if (event.key === "ArrowDown")
      target = entries[Math.min(position + 1, entries.length - 1)];
    if (event.key === "ArrowUp") target = entries[Math.max(position - 1, 0)];
    if (event.key === "Home") target = entries[0];
    if (event.key === "End") target = entries[entries.length - 1];
    if (target) {
      event.preventDefault();
      findRow(target.uri)?.focus();
      if (event.shiftKey) multiSelect(target, index, event);
      else select(target, index);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const child = state.columns[index + 1]?.entries[0];
      if (child && state.columns[index].selected === entry.uri) {
        findRow(child.uri)?.focus();
        select(child, index + 1);
      } else if (entry.directory) select(entry, index);
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      const parent = state.columns[index - 1];
      focusUri = parent.selected;
      findRow(parent.selected)?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (entry.directory) select(entry, index);
      else post({ type: "external", uri: entry.uri });
    }
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      const rect = event.currentTarget.getBoundingClientRect();
      showContext(
        {
          preventDefault: () => event.preventDefault(),
          clientX: rect.left + 20,
          clientY: rect.bottom,
        },
        entry.uri,
      );
    }
  }
  installDropTarget(columns, () => currentDirectory());
  $("roots").addEventListener("change", (event) =>
    post({ type: "root", uri: event.target.value }),
  );
  $("refresh").addEventListener("click", () => post({ type: "refresh" }));
  const options = () =>
    post({
      type: "options",
      showHidden: $("hidden").checked,
      foldersFirst: $("sort").value === "folders",
      sortBy: $("sort").value === "modified" ? "modified" : "name",
    });
  $("hidden").addEventListener("change", options);
  $("sort").addEventListener("change", options);
  menu.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (action && contextUri) {
      if (action === "add") {
        const parent = state.columns.find((column) =>
          column.entries.some((entry) => entry.uri === contextUri),
        );
        const entry = parent?.entries.find((entry) => entry.uri === contextUri);
        void perform("add", {
          target: entry?.directory
            ? entry.uri
            : parent?.uri || currentDirectory(),
        });
      } else if (["move", "trash", "rename"].includes(action)) {
        const uris =
          action === "rename"
            ? [contextUri]
            : selectedUris.has(contextUri)
              ? [...selectedUris]
              : [contextUri];
        void perform(action, { uris });
      } else post({ type: action, uri: contextUri });
    }
    menu.hidden = true;
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) menu.hidden = true;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      menu.hidden = true;
      if (focusUri) findRow(focusUri)?.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      post({ type: "refresh" });
    }
    if (
      !menu.hidden &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      const items = [...menu.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      items[
        (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
          items.length
      ].focus();
    }
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type === "state") render(event.data);
    else if (event.data?.type === "operationResult") {
      const request = pending.get(event.data.requestId);
      if (!request) return;
      pending.delete(event.data.requestId);
      clearTimeout(request.timer);
      if (event.data.ok) request.resolve(event.data);
      else
        request.reject(
          new Error(event.data.error || "파일 작업에 실패했습니다."),
        );
    }
  });
  post({ type: "ready" });
})();
