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
    document, window, acquireVsCodeApi: () => ({ postMessage: message => messages.push(message) }), innerWidth: 1000, innerHeight: 800,
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
