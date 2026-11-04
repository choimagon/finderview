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
  const select = (entry, column) => {
    focusUri = entry.uri;
    post({ type: "select", uri: entry.uri, column });
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
    $("sort").value = next.foldersFirst ? "folders" : "name";
    $("activity").textContent = next.busy
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
        if (entry.directory) button.append(node("span", "arrow", "›"));
        button.addEventListener("click", (event) => {
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
          else select(entry, index);
        });
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
  }
  function findRow(uri) {
    return [...columns.querySelectorAll(".entry")].find(
      (row) => row.dataset.uri === uri,
    );
  }
  function handleKey(event, entry, index) {
    const entries = state.columns[index].entries;
    const position = entries.findIndex((item) => item.uri === entry.uri);
    let target;
    if (event.key === "ArrowDown")
      target = entries[Math.min(position + 1, entries.length - 1)];
    if (event.key === "ArrowUp") target = entries[Math.max(position - 1, 0)];
    if (event.key === "Home") target = entries[0];
    if (event.key === "End") target = entries[entries.length - 1];
    if (target) {
      event.preventDefault();
      findRow(target.uri)?.focus();
      select(target, index);
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
  $("roots").addEventListener("change", (event) =>
    post({ type: "root", uri: event.target.value }),
  );
  $("refresh").addEventListener("click", () => post({ type: "refresh" }));
  const options = () =>
    post({
      type: "options",
      showHidden: $("hidden").checked,
      foldersFirst: $("sort").value === "folders",
    });
  $("hidden").addEventListener("change", options);
  $("sort").addEventListener("change", options);
  menu.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (action && contextUri) post({ type: action, uri: contextUri });
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
  });
  post({ type: "ready" });
})();
