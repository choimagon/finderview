const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');
const smoke = require('./ui-smoke.cjs');
const execute = require('node:util').promisify(require('node:child_process').execFile);

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'column-explorer-test-'));
  const workspace = path.join(temporary, '한글 워크스페이스 #');
  await fs.mkdir(path.join(workspace, '논문 자료', '리비전', '세 번째'), { recursive: true });
  await fs.writeFile(path.join(workspace, '논문 자료', '리비전', '현재 문서.md'), 'nested document');
  await fs.mkdir(path.join(workspace, '빈 폴더'));
  await fs.mkdir(path.join(workspace, '다른 폴더'));
  const filenames = ['수정본.docx', '의견.pdf', '실험 결과.xlsx', '발표.pptx', 'README.md', '분석.py', '<script>& # %.txt', '.hidden'];
  for (const name of filenames) {
    await fs.writeFile(path.join(workspace, name), name.endsWith('.md') || name.endsWith('.py') || name.endsWith('.txt') ? 'unchanged 한글\n' : Buffer.from([0, 255, 1, 2]));
  }
  await fs.mkdir(path.join(workspace, 'build-folder'));
  await fs.mkdir(path.join(workspace, '.vscode'));
  await fs.writeFile(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({'files.exclude': {'**/*.tmp': true, '**/build-folder': true, '**/*.js': {when: '$(basename).ts'}}}));
  for (const name of ['excluded.tmp', 'pair.js', 'pair.ts', 'standalone.js', 'ignored-drop.txt', 'ignored-keep.txt', 'mac-hidden.txt']) await fs.writeFile(path.join(workspace,name), 'fixture');
  await fs.writeFile(path.join(workspace, '.gitignore'), 'ignored-*.txt\n!ignored-keep.txt\n');
  await execute('git', ['init', workspace]);
  if (process.platform === 'darwin') await execute('/usr/bin/chflags', ['hidden', path.join(workspace, 'mac-hidden.txt')]);
  const outside = path.join(temporary, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'outside workspace');
  await fs.symlink(outside, path.join(workspace, '외부 링크'), 'dir');
  const installed = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  let executable = process.env.VSCODE_EXECUTABLE_PATH;
  if (!executable) {
    try { await fs.access(installed); executable = installed; }
    catch { executable = await downloadAndUnzipVSCode('stable'); }
  }
  const port = await new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const number = server.address().port; server.close(() => resolve(number)); }); });
  await fs.mkdir(path.join(temporary, 'profile', 'User'), {recursive:true});
  await fs.writeFile(path.join(temporary, 'profile', 'User', 'settings.json'), JSON.stringify({'window.dialogStyle':'custom'}));
  const ready = path.join(temporary, 'ui-ready');
  const done = path.join(temporary, 'ui-done');
  const externalLog = path.join(temporary, 'external-open');
  let browser;
  try {
    const tests = runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '../test/suite/index.js'),
      extensionTestsEnv: { COLUMN_EXPLORER_TEST_WORKSPACE: workspace, COLUMN_EXPLORER_UI_READY: ready, COLUMN_EXPLORER_UI_DONE: done, COLUMN_EXPLORER_EXTERNAL_LOG: externalLog },
      launchArgs: [workspace, '--user-data-dir', path.join(temporary, 'profile'), '--extensions-dir', path.join(temporary, 'extensions'), `--remote-debugging-port=${port}`, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry'],
    });
    const results = await Promise.allSettled([tests, smoke(port, ready, done, externalLog, workspace).then(value => { browser = value; })]);
    const failures=results.filter(result=>result.status==='rejected');
    if(failures.length) throw new AggregateError(failures.map(result=>result.reason),'VS Code integration/UI checks failed');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
