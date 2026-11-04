const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { FileService } = require('../../out/fileService');
const { ExplorerProvider } = require('../../out/explorerProvider');

exports.run = async function run() {
  const originalClipboard = await vscode.env.clipboard.readText();
  try {
  const rootPath = process.env.COLUMN_EXPLORER_TEST_WORKSPACE;
  assert.ok(rootPath, 'Runner must provide an isolated fixture workspace');
  const root = vscode.Uri.file(rootPath);
  assert.equal(vscode.workspace.workspaceFolders[0].uri.toString(), root.toString());
  const service = new FileService();
  const rootEntries = await service.list(root.toString());
  for (const name of ['수정본.docx', '의견.pdf', '실험 결과.xlsx', '발표.pptx', 'README.md', '분석.py', '<script>& # %.txt']) {
    assert.ok(rootEntries.some(entry => entry.name === name), `Listing must include ${name}`);
  }
  assert.ok(!rootEntries.some(entry => entry.name === '.hidden'));
  assert.ok((await service.list(root.toString(), true)).some(entry => entry.name === '.hidden'));
  const allVisible = await service.list(root.toString(), true);
  for (const name of ['excluded.tmp', 'build-folder', 'pair.js', '.git']) assert.ok(!allVisible.some(entry => entry.name === name), `Explorer files.exclude must hide ${name}`);
  for (const name of ['standalone.js', 'pair.ts', 'mac-hidden.txt', 'ignored-drop.txt']) assert.ok(allVisible.some(entry => entry.name === name), `Explorer must show ${name}`);
  const explorerConfig = vscode.workspace.getConfiguration('explorer', root);
  await explorerConfig.update('excludeGitIgnore', true, vscode.ConfigurationTarget.WorkspaceFolder);
  const gitVisible = await service.list(root.toString(), true);
  assert.ok(!gitVisible.some(entry => entry.name === 'ignored-drop.txt'));
  assert.ok(gitVisible.some(entry => entry.name === 'ignored-keep.txt'));
  await explorerConfig.update('excludeGitIgnore', false, vscode.ConfigurationTarget.WorkspaceFolder);
  console.log('PASS Explorer visibility: files.exclude, sibling rules, Git ignore setting and negation, macOS hidden flag remains visible');
  const sortFolder=vscode.Uri.joinPath(root,'최근순 검증');
  await fs.mkdir(sortFolder.fsPath);
  await fs.writeFile(vscode.Uri.joinPath(sortFolder,'a-old.txt').fsPath,'old');
  await fs.writeFile(vscode.Uri.joinPath(sortFolder,'z-new.txt').fsPath,'new');
  await fs.mkdir(vscode.Uri.joinPath(sortFolder,'middle-folder').fsPath);
  for(const [name,year] of [['a-old.txt',2010],['middle-folder',2020],['z-new.txt',2030]]) {
    const time=new Date(`${year}-01-01T00:00:00Z`);await fs.utimes(vscode.Uri.joinPath(sortFolder,name).fsPath,time,time);
  }
  assert.deepEqual((await service.list(sortFolder.toString(),true,false,'modified')).map(entry=>entry.name),['z-new.txt','middle-folder','a-old.txt'],'Recent sort uses descending modification time across files and folders');
  assert.deepEqual((await service.list(sortFolder.toString(),true,false,'name')).map(entry=>entry.name),['a-old.txt','middle-folder','z-new.txt']);
  console.log('PASS recent sorting: filesystem mtimes, newest first including folders, name sort unchanged');
  const firstFile = rootEntries.findIndex(entry => !entry.directory);
  assert.ok(rootEntries.slice(firstFile).every(entry => !entry.directory), 'Folders must precede files');
  const sortedNames = (await service.list(root.toString(), false, false)).map(entry => entry.name);
  assert.deepEqual(sortedNames, [...sortedNames].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' })));
  let cursor = root;
  for (const name of ['논문 자료', '리비전', '세 번째']) {
    const entries = await service.list(cursor.toString());
    assert.ok(entries.some(entry => entry.name === name && entry.directory));
    cursor = vscode.Uri.joinPath(cursor, name);
  }
  assert.deepEqual(await service.list(cursor.toString()), []);
  assert.deepEqual(await service.list(vscode.Uri.joinPath(root, '빈 폴더').toString()), []);
  const special = vscode.Uri.joinPath(root, '<script>& # %.txt');
  const metadata = await service.metadata(special.toString());
  assert.equal(metadata.name, '<script>& # %.txt');
  assert.equal(metadata.extension, 'txt');
  assert.equal(metadata.path, special.fsPath);
  assert.equal(metadata.size, Buffer.byteLength('unchanged 한글\n'));
  await assert.rejects(service.validate(vscode.Uri.file(path.dirname(rootPath)).toString()));
  await assert.rejects(service.validate(vscode.Uri.joinPath(root, '외부 링크', 'secret.txt').toString()));
  await assert.rejects(service.validate(root.with({ query: 'injected' }).toString()));
  await assert.rejects(service.list(vscode.Uri.joinPath(root, '존재하지 않음').toString()));
  const readme = vscode.Uri.joinPath(root, 'README.md');
  const before = await fs.readFile(readme.fsPath);
  await service.open(readme.toString());
  assert.ok(vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === readme.toString()), 'Text file should open in VS Code');
  assert.deepEqual(await fs.readFile(readme.fsPath), before, 'Opening a file must not modify its contents');
  console.log('PASS FileService: nested/empty directories, all file types, hidden files, sorting, metadata, Unicode/escaping, workspace and symlink boundaries, read-only editor opening');
  await require('./operations').run(root);
  const noopEvent = () => ({ dispose() {} });
  const provider = new ExplorerProvider({ webview: { onDidReceiveMessage: noopEvent, postMessage: async () => true }, onDidDispose: noopEvent }, vscode.Uri.file(path.resolve(__dirname, '../..')));
  try {
    await provider.receive({ type: 'ready' });
    assert.equal(provider.state.columns.length, 1);
    const toggleFolder=provider.state.columns[0].entries.find(item=>item.name==='논문 자료');
    await provider.receive({type:'select',uri:toggleFolder.uri,column:0,toggle:true});
    assert.equal(provider.state.columns.length,2);
    await provider.receive({type:'select',uri:toggleFolder.uri,column:0,toggle:true});
    assert.equal(provider.state.columns.length,1,'Second click collapses the folder');
    await provider.refresh();
    assert.equal(provider.state.columns.length,1,'Refresh must preserve collapsed state');
    await provider.receive({type:'select',uri:toggleFolder.uri,column:0,toggle:true});
    assert.equal(provider.state.columns.length,2,'Third click expands the folder');
    await provider.receive({type:'select',uri:toggleFolder.uri,column:0,toggle:true});
    const originalToggleMetadata=provider.files.metadata.bind(provider.files);
    let releaseToggle;
    const toggleGate=new Promise(resolve=>{releaseToggle=resolve;});
    provider.files.metadata=async value=>{if(value===toggleFolder.uri)await toggleGate;return originalToggleMetadata(value);};
    const pendingOpen=provider.select(toggleFolder.uri,0,true);
    const pendingClose=provider.select(toggleFolder.uri,0,true);
    releaseToggle();await Promise.all([pendingOpen,pendingClose]);
    assert.equal(provider.state.columns.length,1,'Rapid second click cancels pending expansion');
    provider.files.metadata=originalToggleMetadata;
    for (const [index, name] of ['논문 자료', '리비전', '세 번째'].entries()) {
      const entry = provider.state.columns[index].entries.find(item => item.name === name);
      await provider.receive({ type: 'select', uri: entry.uri, column: index });
      assert.equal(provider.state.columns.length, index + 2);
    }
    await provider.receive({ type: 'refresh' });
    assert.equal(provider.state.columns.length, 4, 'Refresh must retain a valid selected path');
    await fs.rmdir(vscode.Uri.joinPath(root, '논문 자료', '리비전', '세 번째').fsPath);
    await provider.refresh();
    const deletionDeadline = Date.now() + 5000;
    while (provider.state.columns.length !== 3 && Date.now() < deletionDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      await provider.refresh();
    }
    assert.equal(provider.state.columns.length, 3, 'Deleted selection must return to its valid parent');
    assert.equal(provider.state.columns[2].selected, undefined);
    await provider.revealLocation(vscode.Uri.joinPath(root, '논문 자료', '리비전', '현재 문서.md'));
    assert.equal(provider.state.columns.length, 3);
    assert.equal(provider.state.metadata.name, '현재 문서.md');
    assert.equal(provider.state.columns[2].selected, vscode.Uri.joinPath(root, '논문 자료', '리비전', '현재 문서.md').toString());
    const sibling = provider.state.columns[0].entries.find(item => item.name === '다른 폴더');
    await provider.receive({ type: 'select', uri: sibling.uri, column: 0 });
    assert.equal(provider.state.columns.length, 2, 'Changing an ancestor must truncate descendant columns');
    assert.equal(provider.state.columns[1].uri, sibling.uri);
    await provider.receive({ type: 'select', uri: readme.toString(), column: 0 });
    assert.equal(provider.state.columns.length, 1, 'Selecting a file must clear old descendant columns');
    assert.equal(provider.state.metadata.name, 'README.md');
    const folder = provider.state.columns[0].entries.find(item => item.name === '논문 자료');
    const originalMetadata = provider.files.metadata.bind(provider.files);
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    provider.files.metadata = async value => { if (value === folder.uri) await barrier; return originalMetadata(value); };
    const slowSelection = provider.select(folder.uri, 0);
    await provider.select(sibling.uri, 0);
    release();
    await slowSelection;
    assert.equal(provider.state.columns.length, 2);
    assert.equal(provider.state.columns[1].uri, sibling.uri, 'A stale async selection must not restore an earlier path');
    await provider.receive({ type: 'options', showHidden: true, foldersFirst: false });
    assert.ok(provider.state.columns[0].entries.some(item => item.name === '.hidden'));
    await provider.receive({ type: 'root', uri: vscode.Uri.file(path.dirname(rootPath)).toString() });
    assert.ok(provider.state.error, 'Forged root messages must report an error');
    assert.equal(provider.state.root, root.toString());
    console.log('PASS ExplorerProvider: three-level columns, ancestor truncation, file metadata, refresh preservation/deletion, async selection race, options, forged root denial');
  } finally { provider.dispose(); }
  await fs.mkdir(vscode.Uri.joinPath(root, '논문 자료', '리비전', '세 번째').fsPath, { recursive: true });
  if (process.env.COLUMN_EXPLORER_EXTERNAL_LOG) {
    FileService.prototype.external = async function(value) {
      await this.validate(value);
      await fs.writeFile(process.env.COLUMN_EXPLORER_EXTERNAL_LOG, value);
    };
  }
  // Isolate confirmation decisions from native OS dialog automation. The
  // operation itself still uses the real filesystem and system Trash.
  const {FileOperations} = require('../../out/fileOperations');
  const originalTrash = FileOperations.prototype.trash;
  let trashInvocation = 0;
  FileOperations.prototype.trash = async function(values) {
    this.confirm = async () => ++trashInvocation > 1;
    return originalTrash.call(this,values);
  };
  await vscode.commands.executeCommand('columnExplorer.open');
  console.log('PASS Column Explorer command created a real WebviewPanel in the Extension Development Host');
  if (process.env.COLUMN_EXPLORER_UI_READY) {
    await fs.writeFile(process.env.COLUMN_EXPLORER_UI_READY, 'ready');
    const deadline = Date.now() + 120000;
    while (true) {
      try { await fs.access(process.env.COLUMN_EXPLORER_UI_DONE); break; } catch {}
      assert.ok(Date.now() < deadline, 'UI smoke runner must complete within 120 seconds');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await vscode.env.clipboard.readText(), special.fsPath, 'Context menu must copy the exact unescaped path');
    assert.deepEqual(await fs.readFile(readme.fsPath), before, 'UI double-click opening must not change the file');
  }
  } finally {
    await vscode.env.clipboard.writeText(originalClipboard);
  }
};
