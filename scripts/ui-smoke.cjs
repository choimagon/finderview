const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function smoke(port, ready, done, externalLog) {
  let browser;
  try {
    const deadline = Date.now() + 45000;
    while (true) {
      try { await fs.access(ready); break; } catch {}
      assert.ok(Date.now() < deadline, 'Extension Host must complete integration tests before UI smoke');
      await delay(100);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    let frame;
    let page;
    while (!frame) {
      for (const candidate of browser.contexts().flatMap(context => context.pages())) {
        for (const child of candidate.frames()) {
          if (await child.locator('#columns').count()) { frame = child; page = candidate; break; }
        }
        if (frame) break;
      }
      assert.ok(Date.now() < deadline, 'Column Explorer webview must render');
      if (!frame) await delay(100);
    }
    const waitColumns = count => frame.waitForFunction(expected => document.querySelectorAll('#columns .column').length === expected && document.getElementById('columns').getAttribute('aria-busy') === 'false', count);
    const row = name => frame.locator('.entry').filter({ has: frame.getByText(name, { exact: true }) });
    await waitColumns(1);
    for (const name of ['excluded.tmp', 'build-folder', 'pair.js', '.git']) assert.equal(await row(name).count(), 0);
    for (const name of ['mac-hidden.txt', '.hidden', 'standalone.js']) assert.equal(await row(name).count(), 1);
    for (const name of ['수정본.docx', '의견.pdf', '실험 결과.xlsx', '발표.pptx', 'README.md', '분석.py', '<script>& # %.txt']) assert.equal(await row(name).count(), 1, `${name} must appear in real webview`);
    assert.equal(await frame.locator('#columns script').count(), 0, 'Special filenames must be rendered as plain text');
    for (const [index, name] of ['논문 자료', '리비전', '세 번째'].entries()) {
      await row(name).click();
      await waitColumns(index + 2);
    }
    assert.match(await frame.locator('.column').last().innerText(), /빈 폴더/);
    const artifact = path.resolve(__dirname, '../artifacts/column-explorer.png');
    await fs.mkdir(path.dirname(artifact), { recursive: true });
    await page.screenshot({ path: artifact });
    await row('다른 폴더').click();
    await waitColumns(2);
    assert.match(await frame.locator('.column').last().innerText(), /다른 폴더/);
    await row('README.md').click();
    await waitColumns(1);
    await frame.waitForFunction(() => document.getElementById('metadata').textContent.includes('README.md'));
    await frame.locator('#hidden').check();
    await frame.waitForFunction(() => [...document.querySelectorAll('.filename')].some(element => element.textContent === '.hidden'));
    await frame.locator('#sort').selectOption('name');
    await row('<script>& # %.txt').click({ button: 'right' });
    assert.equal(await frame.locator('#context').isVisible(), true);
    await frame.locator('#context [data-action="copy"]').click();
    await row('README.md').dblclick();
    const externalDeadline = Date.now() + 5000;
    while (true) {
      try { assert.match(await fs.readFile(externalLog, 'utf8'), /README\.md$/); break; } catch (error) { if (Date.now() > externalDeadline) throw error; await delay(50); }
    }
    await row('README.md').click({button:'right'});
    await frame.locator('#context [data-action="open"]').click();
    await page.locator('.tab.active').filter({ hasText: 'README.md' }).waitFor();
    await page.getByRole('button', { name: 'FinderView: Open', exact: true }).click();
    await page.locator('.tab.active').filter({ hasText: 'FinderView' }).waitFor();
    assert.equal(await page.locator('.tab').filter({ hasText: 'FinderView' }).count(), 1, 'Toolbar button must reuse the existing explorer tab');
    await row('논문 자료').click();
    await waitColumns(2);
    await row('리비전').click();
    await waitColumns(3);
    await row('현재 문서.md').click({button:'right'});
    await frame.locator('#context [data-action="open"]').click();
    await page.locator('.tab.active').filter({ hasText: '현재 문서.md' }).waitFor();
    await page.getByRole('button', { name: 'FinderView: Open', exact: true }).click();
    await page.locator('.tab.active').filter({ hasText: 'FinderView' }).waitFor();
    await waitColumns(3);
    await frame.waitForFunction(() => document.querySelector('.entry.selected .filename') && document.getElementById('metadata').textContent.includes('현재 문서.md'));
    assert.equal(await row('현재 문서.md').getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: path.resolve(__dirname, '../artifacts/finderview-toolbar.png') });
    console.log('PASS editor title FinderView icon: click opens existing explorer tab');
    console.log(`PASS real Webview UI: all file types, escaped names, 4 columns, empty folder, ancestor reset, metadata, hidden files, sorting, context menu, double-click dispatches external opening; context menu opens editor. Screenshot: ${artifact}`);
  } finally {
    await fs.writeFile(done, 'done');
    // The VS Code test runner owns browser lifetime. Disconnect the CDP client
    // after its process exits; closing a connected browser here would quit it.
  }
  return browser;
};
