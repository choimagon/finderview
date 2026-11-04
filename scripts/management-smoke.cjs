const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function managementSmoke(frame, page, workspace) {
  const row = name => frame.locator('.entry').filter({has:frame.getByText(name,{exact:true})});
  const folder = path.join(workspace,'논문 자료','리비전');
  const bytes = [0,255,17,2,92,128];
  try {
  const waitIdle = async () => { await frame.waitForFunction(()=>document.getElementById('columns').getAttribute('aria-busy')==='false' && !document.getElementById('add-files').disabled); };
  const drop = async (name, content) => {
    await frame.evaluate(({name,content}) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(content)],name,{type:'application/octet-stream'}));
      document.querySelector('#columns .column:last-child .entries').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    },{name,content});
  };
  await drop('드래그 추가 #.txt',bytes);
  await row('드래그 추가 #.txt').waitFor();await waitIdle();
  assert.deepEqual([...await fs.readFile(path.join(folder,'드래그 추가 #.txt'))],bytes);
  await row('드래그 추가 #.txt').click({button:'right'});
  await frame.locator('#context [data-action="rename"]').click();
  let input=page.locator('.quick-input-widget input:visible');
  await input.waitFor();await input.fill('이름 변경 #.txt');await input.press('Enter');
  await row('이름 변경 #.txt').waitFor();await waitIdle();
  assert.equal(await row('드래그 추가 #.txt').count(),0);
  await drop('이름 변경 #.txt',[9,8,7]);
  await page.locator('.quick-input-title').filter({hasText:/^같은 이름이 이미 있습니다:/}).waitFor();
  await page.locator('.quick-input-widget input:visible').press('ArrowDown');
  await page.locator('.quick-input-widget input:visible').press('Enter');
  input=page.locator('.quick-input-widget input:visible');
  await page.locator('.quick-input-title').filter({hasText:/^이름 변경$/}).waitFor();
  await input.waitFor();await input.fill('다른 이름.txt');await input.press('Enter');
  await row('다른 이름.txt').waitFor();await waitIdle();
  assert.deepEqual([...await fs.readFile(path.join(folder,'이름 변경 #.txt'))],bytes);
  assert.deepEqual([...await fs.readFile(path.join(folder,'다른 이름.txt'))],[9,8,7]);
  await drop('다른 이름.txt',[3,4,5,6]);
  await page.locator('.quick-input-title').filter({hasText:/^같은 이름이 이미 있습니다:/}).waitFor();
  await page.locator('.quick-input-widget input:visible').press('Enter');
  await waitIdle();
  assert.deepEqual([...await fs.readFile(path.join(folder,'다른 이름.txt'))],[3,4,5,6]);
  await row('이름 변경 #.txt').click();
  await row('다른 이름.txt').click({modifiers:[process.platform==='darwin'?'Meta':'Control']});
  assert.equal(await frame.locator('#selection-count').textContent(),'2개 선택');
  await frame.evaluate(()=>{
    const transfer=new DataTransfer();
    transfer.setData('application/x-finderview-uris',JSON.stringify([...document.querySelectorAll('.entry.multi-selected')].map(el=>el.dataset.uri)));
    const target=[...document.querySelectorAll('.entry')].find(el=>el.querySelector('.filename')?.textContent==='세 번째');
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
  });
  await waitIdle();
  assert.deepEqual([...await fs.readFile(path.join(folder,'세 번째','이름 변경 #.txt'))],bytes);
  assert.equal(await row('이름 변경 #.txt').count(),0);
  await row('세 번째').click();
  await row('이름 변경 #.txt').waitFor();
  await row('이름 변경 #.txt').click({button:'right'});
  await frame.locator('#context [data-action="trash"]').click();
  await waitIdle();
  assert.deepEqual([...await fs.readFile(path.join(folder,'세 번째','이름 변경 #.txt'))],bytes);
  await row('이름 변경 #.txt').click({button:'right'});
  await frame.locator('#context [data-action="trash"]').click();
  await waitIdle();
  await assert.rejects(fs.access(path.join(folder,'세 번째','이름 변경 #.txt')));
  assert.equal(await row('이름 변경 #.txt').count(),0);
  const artifact=path.resolve(__dirname,'../artifacts/finderview-file-management.png');
  await page.screenshot({path:artifact});
  console.log('PASS real file-management UI: external binary drop, rename input, collision rename/overwrite, multi-select internal drag move, trash cancellation and confirmed trash');
  } catch(error) {
    console.error('MANAGEMENT UI ERROR',await frame.locator('#error').textContent(), await frame.locator('#activity').textContent());
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/finderview-management-failure.png')});
    throw error;
  }
};
