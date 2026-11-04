// Exercise the actual webview script with a small in-memory DOM. This checks
// message interactions; Extension Host tests separately verify filesystem APIs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness() {
  const elements = new Map();
  const messages = [];
  const document = { activeElement: null, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } };
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {};
      this.className = ''; this.textContent = ''; this.scrollTop = 0; this.scrollLeft = 0;
      this.classList = { contains: name => this.className.split(' ').includes(name), add: name => { this.className += ` ${name}`; } };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = [...children]; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [
        ...(selector[0] === '.' ? child.classList.contains(selector.slice(1)) : child.tagName === selector) ? [child] : [],
        ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    get lastElementChild() { return this.children.at(-1); }
    getBoundingClientRect() { return { left: 0, bottom: 30 }; }
    fire(name, extra = {}) { this.listeners[name]?.({ target: this, currentTarget: this, detail: 1, preventDefault() {}, ...extra }); }
  }
  document.createElement = tag => new Element(tag);
  document.getElementById = id => { if (!elements.has(id)) elements.set(id, new Element('div')); return elements.get(id); };
  const window = { addEventListener(name, fn) { this[name] = fn; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../media/explorer.js'), 'utf8'), {
    setTimeout: () => 0, clearTimeout: () => {}, btoa, document, window, acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }), innerWidth: 1000, innerHeight: 800,
  });
  return { messages, elements, document, render: state => window.message({ data: state }) };
}
const entry = (name, directory = false) => ({ name, directory, uri: `file:///workspace/${encodeURIComponent(name)}`, extension: name.split('.').at(-1) });
const root = 'file:///workspace';
function state(entries, extra = {}) {
  return { type: 'state', roots: [{ uri: root, name: '한글 워크스페이스' }], root, columns: [{ uri: root, name: '한글 워크스페이스', entries }], foldersFirst: true, showHidden: false, busy: false, ...extra };
}

test('renders all binary filenames safely and selects the exact encoded URI', () => {
  const h = harness();
  const entries = ['수정본.docx', '의견.pdf', '실험 결과.xlsx', '발표.pptx', '<script>& # %.md', '분석.py'].map(name => entry(name));
  h.render(state(entries));
  const rows = h.elements.get('columns').querySelectorAll('.entry');
  assert.equal(rows.length, entries.length);
  assert.equal(rows[4].querySelector('.filename').textContent, '<script>& # %.md');
  rows[4].fire('click');
  assert.equal(h.messages.at(-1).uri, entries[4].uri);
  assert.equal(h.messages.at(-1).column, 0);
});

test('double click opens a file externally even when the host replaces its DOM after the first click', () => {
  const h = harness(), file = entry('한글 # %.pdf');
  h.render(state([file]));
  const first = h.elements.get('columns').querySelector('.entry');
  first.fire('click');
  assert.equal(h.messages.at(-1).type, 'select');
  h.render(state([file], { busy: true }));
  const second = h.elements.get('columns').querySelector('.entry');
  assert.notEqual(first, second);
  second.fire('click');
  assert.equal(h.messages.at(-1).type, 'external');
  assert.equal(h.messages.at(-1).uri, file.uri);
});

test('different files and keyboard-generated clicks never count as double clicks', () => {
  const h = harness(), a = entry('a.md'), b = entry('b.md');
  h.render(state([a, b]));
  const rows = h.elements.get('columns').querySelectorAll('.entry');
  rows[0].fire('click'); rows[1].fire('click'); rows[1].fire('click', { detail: 0 });
  assert.equal(h.messages.filter(message => message.type === 'external').length, 0);
});

test('replaces deeper columns on a new state and displays empty/error states', () => {
  const h = harness();
  const nested = [0, 1, 2, 3].map(index => ({ uri: `${root}/${index}`, name: String(index), entries: [] }));
  h.render(state([], { columns: nested }));
  assert.equal(h.elements.get('columns').children.length, 4);
  h.render(state([]));
  assert.equal(h.elements.get('columns').children.length, 1);
  assert.equal(h.elements.get('columns').querySelector('.empty').textContent, '빈 폴더입니다');
  h.render(state([], { error: '권한 없음' }));
  assert.equal(h.elements.get('error').textContent, '권한 없음');
  assert.equal(h.elements.get('error').hidden, false);
});

test('keyboard moves selection and Enter opens files', () => {
  const h = harness(), a = entry('a.md'), b = entry('b.md');
  h.render(state([a, b]));
  const rows = h.elements.get('columns').querySelectorAll('.entry');
  rows[0].fire('keydown', { key: 'ArrowDown' });
  assert.equal(h.messages.at(-1).uri, b.uri);
  assert.equal(h.document.activeElement, rows[1]);
  rows[1].fire('keydown', { key: 'Enter' });
  assert.equal(h.messages.at(-1).type, 'external');
});


test('Ctrl and Shift select multiple files, and Cmd+A selects the current column', () => {
  const h = harness(), files = ['a.txt', 'b.txt', 'c.txt'].map(name => entry(name));
  h.render(state(files));
  const rows = h.elements.get('columns').querySelectorAll('.entry');
  rows[0].fire('click'); rows[1].fire('click', { ctrlKey: true });
  assert.equal(h.elements.get('selection-count').textContent, '2개 선택');
  assert.equal(rows[0]['aria-selected'], 'true');
  assert.equal(rows[1]['aria-selected'], 'true');
  rows[2].fire('click', { shiftKey: true });
  assert.equal(h.elements.get('selection-count').textContent, '3개 선택');
  rows[1].fire('click', { ctrlKey: true });
  assert.equal(h.elements.get('selection-count').textContent, '2개 선택');
  rows[0].fire('keydown', { key: 'a', metaKey: true });
  assert.equal(h.elements.get('selection-count').textContent, '3개 선택');
  assert.equal(h.messages.filter(message => message.type === 'external').length, 0);
});

for (const action of ['move', 'rename', 'trash']) {
  test(`context menu ${action} sends selected URI operation`, () => {
    const h = harness(), a = entry('한글.txt'), b = entry('두 번째.txt');
    h.render(state([a, b]));
    const rows = h.elements.get('columns').querySelectorAll('.entry');
    rows[0].fire('click'); rows[1].fire('click', { metaKey: true });
    const menu = h.elements.get('context');
    menu.append(h.document.createElement('button'));
    rows[0].fire('contextmenu', { clientX: 0, clientY: 0 });
    menu.fire('click', { target: { dataset: { action } } });
    const message = h.messages.at(-1);
    assert.equal(message.type, 'operation');
    assert.equal(message.action, action);
    assert.deepEqual(Array.from(message.uris), action === 'rename' ? [a.uri] : [a.uri, b.uri]);
    h.render({ type: 'operationResult', requestId: message.requestId, ok: true });
  });
}

test('internal drag sends move by default and modifier sends copy to the folder URI', () => {
  for (const copy of [false, true]) {
    const h = harness(), file = entry('source.txt'), folder = entry('destination', true);
    h.render(state([file, folder]));
    const row = h.elements.get('columns').querySelectorAll('.entry')[1];
    row.fire('drop', { stopPropagation() {}, altKey: copy, dataTransfer: {
      getData(type) { return type === 'application/x-finderview-uris' ? JSON.stringify([file.uri]) : ''; },
    }});
    const message = h.messages.at(-1);
    assert.equal(message.action, 'transfer');
    assert.equal(message.target, folder.uri);
    assert.equal(message.copy, copy);
    assert.deepEqual(Array.from(message.uris), [file.uri]);
    h.render({ type: 'operationResult', requestId: message.requestId, ok: true });
  }
});

test('external file drop stages exact binary bytes before committing the import', async () => {
  const h = harness();
  h.render(state([]));
  const bytes = Uint8Array.from([0, 255, 1]);
  const file = { name: '새 문서.pdf', size: bytes.length, slice(start, end) {
    return { async arrayBuffer() { return bytes.slice(start, end).buffer; } };
  }};
  h.elements.get('columns').querySelector('.entries').fire('drop', {
    stopPropagation() {}, dataTransfer: { getData() { return ''; }, files: [file], items: [] },
  });
  let message = h.messages.at(-1);
  assert.equal(message.action, 'upload-start');
  assert.equal(message.target, root);
  h.render({ type: 'operationResult', requestId: message.requestId, ok: true, uploadId: 'test-upload' });
  await new Promise(setImmediate);
  message = h.messages.at(-1);
  assert.equal(message.action, 'upload-chunk');
  assert.equal(message.relativePath, file.name);
  assert.equal(message.offset, 0);
  assert.deepEqual(Buffer.from(message.data, 'base64'), Buffer.from(bytes));
  h.render({ type: 'operationResult', requestId: message.requestId, ok: true });
  await new Promise(setImmediate);
  message = h.messages.at(-1);
  assert.equal(message.action, 'upload-finish');
  assert.equal(message.uploadId, 'test-upload');
  h.render({ type: 'operationResult', requestId: message.requestId, ok: true });
  await new Promise(setImmediate);
});

test('folder clicks request toggle but keyboard Right only requests expansion', () => {
  const h = harness(), folder = entry('폴더', true);
  h.render(state([folder]));
  h.elements.get('columns').querySelector('.entry').fire('click');
  assert.equal(h.messages.at(-1).type, 'select');
  assert.equal(h.messages.at(-1).toggle, true);
  h.render(state([folder], { columns: [
    { uri: root, name: 'root', entries: [folder], selected: folder.uri },
    { uri: folder.uri, name: folder.name, entries: [] },
  ] }));
  h.elements.get('columns').querySelector('.entry').fire('click');
  assert.equal(h.messages.at(-1).toggle, true, 'Clicking the open folder must request collapse');
  h.render(state([folder], { columns: [
    { uri: root, name: 'root', entries: [folder], selected: folder.uri, collapsed: true },
  ] }));
  h.elements.get('columns').querySelector('.entry').fire('keydown', { key: 'ArrowRight' });
  assert.equal(h.messages.at(-1).toggle, false, 'Right arrow expands without toggling a folder closed');
  assert.equal(h.messages.filter(message => message.type === 'external').length, 0);
});

const fakeDropFile = (name, content) => {
  const bytes = Uint8Array.from(content);
  return { name, size: bytes.length, slice(start, end) {
    return { async arrayBuffer() { return bytes.slice(start, end).buffer; } };
  } };
};
async function acknowledgeUpload(h) {
  const seen = [];
  for (let tick = 0; tick < 40; tick++) {
    await new Promise(setImmediate);
    const operation = h.messages.filter(message => message.type === 'operation')[seen.length];
    if (!operation) continue;
    seen.push(operation);
    h.render({ type: 'operationResult', requestId: operation.requestId, ok: true,
      ...(operation.action === 'upload-start' ? { uploadId: 'captured-upload' } : {}),
    });
    if (operation.action === 'upload-finish') { await new Promise(setImmediate); return seen; }
  }
  assert.fail('Expected staged upload to finish');
}

test('native File items are captured synchronously and dropped into the hovered folder', async () => {
  const h = harness(), folder = entry('목적 폴더', true);
  h.render(state([folder]));
  let protectedStoreOpen = true, captured = 0;
  const file = fakeDropFile('외부 파일 #.pdf', [0, 255, 2]);
  h.elements.get('columns').querySelector('.entry').fire('drop', {
    shiftKey: true, stopPropagation() {}, dataTransfer: {
      getData() { return ''; }, files: [], items: [{ kind: 'file',
        webkitGetAsEntry() { return null; },
        getAsFile() { assert.equal(protectedStoreOpen, true, 'File must be captured during the drop event'); captured++; return file; },
      }],
    },
  });
  protectedStoreOpen = false;
  assert.equal(captured, 1);
  const operations = await acknowledgeUpload(h);
  assert.equal(operations[0].target, folder.uri);
  const chunk = operations.find(message => message.action === 'upload-chunk');
  assert.equal(chunk.relativePath, file.name);
  assert.deepEqual(Buffer.from(chunk.data, 'base64'), Buffer.from([0, 255, 2]));
});

test('mixed directory and standalone File drops preserve both and empty directories', async () => {
  const h = harness(), destination = entry('목적 폴더', true);
  h.render(state([destination]));
  const nestedFile = fakeDropFile('안쪽 파일.txt', [97, 98, 99]);
  const standalone = fakeDropFile('바깥 파일.bin', [0, 255]);
  let readBatch = false, protectedStoreOpen = true, standaloneCaptured = false;
  const emptyDirectory = { name: '빈 폴더', isDirectory: true, createReader() {
    return { readEntries(resolve) { resolve([]); } };
  } };
  const directoryEntry = { name: '가져온 폴더', isDirectory: true, createReader() {
    return { readEntries(resolve) {
      if (readBatch) resolve([]);
      else { readBatch = true; resolve([emptyDirectory, { name: nestedFile.name, isFile: true, file(resolve) { resolve(nestedFile); } }]); }
    } };
  } };
  h.elements.get('columns').querySelector('.entry').fire('drop', {
    shiftKey: true, stopPropagation() {}, dataTransfer: {
      getData() { return ''; }, files: [], items: [
        { kind: 'file', webkitGetAsEntry() { return directoryEntry; } },
        { kind: 'file', webkitGetAsEntry() { return null; }, getAsFile() {
          assert.equal(protectedStoreOpen, true, 'Standalone file must be captured before asynchronous directory walking');
          standaloneCaptured = true; return standalone;
        } },
      ],
    },
  });
  protectedStoreOpen = false;
  assert.equal(standaloneCaptured, true);
  const operations = await acknowledgeUpload(h);
  assert.equal(operations[0].target, destination.uri);
  const chunks = operations.filter(message => message.action === 'upload-chunk');
  assert.deepEqual(chunks.filter(message => message.directory).map(message => message.relativePath), ['가져온 폴더', '가져온 폴더/빈 폴더']);
  assert.deepEqual(chunks.filter(message => !message.directory).map(message => message.relativePath), ['가져온 폴더/안쪽 파일.txt', '바깥 파일.bin']);
  assert.deepEqual(Buffer.from(chunks.find(message => message.relativePath === '바깥 파일.bin').data, 'base64'), Buffer.from([0, 255]));
});
