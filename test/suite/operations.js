const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const vscode = require('vscode');
const { FileService } = require('../../out/fileService');
const { FileOperations } = require('../../out/fileOperations');

// All file changes are confined to this suite's isolated workspace fixture.
exports.run = async function run(root) {
  const fixture = vscode.Uri.joinPath(root, `file-operations-${randomUUID()}`);
  const source = vscode.Uri.joinPath(fixture, '원본 #');
  const target = vscode.Uri.joinPath(fixture, '대상 폴더');
  const moved = vscode.Uri.joinPath(fixture, '이동 폴더');
  await fs.mkdir(source.fsPath, { recursive: true });
  await fs.mkdir(target.fsPath);
  await fs.mkdir(moved.fsPath);
  const service = new FileService();
  let allowTrash = false;
  const choices = [], names = [];
  const dialogs = {
    async conflict() { return choices.shift() ?? 'cancel'; },
    async name() { return names.shift(); },
  };
  const operations = new FileOperations(service, async () => allowTrash, dialogs);
  const uri = (base, name) => vscode.Uri.joinPath(base, name);
  const exists = async value => {
    try { await fs.lstat(value.fsPath); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  const binary = Buffer.from([0, 255, 1, 2, 128, 13, 10]);
  try {
    const document = uri(source, '한글 공백 # %.docx');
    await fs.writeFile(document.fsPath, binary);
    assert.equal(await operations.transfer([document.toString()], target.toString(), true), 1);
    assert.deepEqual(await fs.readFile(uri(target, '한글 공백 # %.docx').fsPath), binary);
    assert.deepEqual(await fs.readFile(document.fsPath), binary, 'Copy must preserve original bytes');
    assert.equal(await operations.transfer([document.toString(), document.toString()], moved.toString()), 1, 'Repeated selections must be deduplicated');
    assert.equal(await exists(document), false);
    assert.deepEqual(await fs.readFile(uri(moved, '한글 공백 # %.docx').fsPath), binary);

    const first = uri(source, '다중 하나.txt'), second = uri(source, '다중 둘.txt');
    await fs.writeFile(first.fsPath, 'one');
    await fs.writeFile(second.fsPath, 'two');
    assert.equal(await operations.transfer([first.toString(), second.toString()], moved.toString()), 2);
    assert.equal(await exists(first), false);
    assert.equal(await exists(second), false);
    assert.equal(await fs.readFile(uri(moved, '다중 하나.txt').fsPath, 'utf8'), 'one');
    assert.equal(await fs.readFile(uri(moved, '다중 둘.txt').fsPath, 'utf8'), 'two');

    const collision = uri(source, '충돌.txt'), old = uri(target, '충돌.txt');
    await fs.writeFile(collision.fsPath, 'new contents');
    await fs.writeFile(old.fsPath, 'old contents');
    choices.push('skip');
    assert.equal(await operations.transfer([collision.toString()], target.toString()), 0);
    assert.equal(await fs.readFile(old.fsPath, 'utf8'), 'old contents');
    assert.equal(await fs.readFile(collision.fsPath, 'utf8'), 'new contents');
    const unaffected = uri(source, '배치 취소.txt');
    await fs.writeFile(unaffected.fsPath, 'untouched');
    choices.push('cancel');
    assert.equal(await operations.transfer([unaffected.toString(), collision.toString()], target.toString()), 0);
    assert.equal(await exists(unaffected), true, 'Cancel during collision planning must not move earlier selections');
    assert.equal(await exists(uri(target, '배치 취소.txt')), false);
    choices.push('rename'); names.push('충돌 복사본 #.txt');
    assert.equal(await operations.transfer([collision.toString()], target.toString(), true), 1);
    assert.equal(await fs.readFile(old.fsPath, 'utf8'), 'old contents');
    assert.equal(await fs.readFile(uri(target, '충돌 복사본 #.txt').fsPath, 'utf8'), 'new contents');
    choices.push('overwrite');
    assert.equal(await operations.transfer([collision.toString()], target.toString(), true), 1);
    assert.equal(await fs.readFile(old.fsPath, 'utf8'), 'new contents');
    assert.equal(await fs.readFile(collision.fsPath, 'utf8'), 'new contents');

    const folder = uri(source, '폴더');
    const child = uri(folder, '세 단계/빈 폴더');
    await fs.mkdir(child.fsPath, { recursive: true });
    await fs.writeFile(uri(folder, '세 단계/파일.txt').fsPath, 'folder content');
    assert.equal(await operations.transfer([folder.toString(), uri(folder, '세 단계/파일.txt').toString()], target.toString(), true), 1, 'Parent and child selection copies the parent once');
    assert.equal(await exists(uri(target, '폴더/세 단계/빈 폴더')), true);
    assert.equal(await fs.readFile(uri(target, '폴더/세 단계/파일.txt').fsPath, 'utf8'), 'folder content');
    await assert.rejects(operations.transfer([folder.toString()], child.toString()), /하위|자기/);
    await assert.rejects(operations.transfer([root.toString()], target.toString()), /루트/);
    await assert.rejects(operations.trash([root.toString()]), /루트/);
    await assert.rejects(operations.transfer([uri(root, '../outside/secret.txt').toString()], target.toString()));
    await assert.rejects(operations.transfer([uri(root, '외부 링크/secret.txt').toString()], target.toString()));
    assert.equal(await operations.transfer([uri(moved, '한글 공백 # %.docx').toString()], moved.toString()), 0, 'Moving to its current folder is a no-op');
    const protectedFile = uri(source, '삭제 취소.txt');
    await fs.writeFile(protectedFile.fsPath, 'keep');
    assert.equal(await operations.trash([protectedFile.toString()]), 0);
    assert.equal(await fs.readFile(protectedFile.fsPath, 'utf8'), 'keep', 'Canceled deletion must leave contents unchanged');

    const renamed = uri(source, '새 이름 공백 # %.txt');
    names.push('새 이름 공백 # %.txt');
    assert.equal(await operations.rename(protectedFile.toString()), 1);
    assert.equal(await exists(protectedFile), false);
    assert.equal(await fs.readFile(renamed.fsPath, 'utf8'), 'keep');
    names.push('../escape.txt');
    await assert.rejects(operations.rename(renamed.toString()), /이름/);
    assert.equal(await fs.readFile(renamed.fsPath, 'utf8'), 'keep');
    names.push(undefined);
    assert.equal(await operations.rename(renamed.toString()), 0);
    names.push('충돌.txt'); choices.push('skip');
    assert.equal(await operations.rename(renamed.toString()), 0);
    assert.equal(await exists(renamed), true);
    const renamedFolder = uri(source, '이름 바꾼 폴더');
    names.push('이름 바꾼 폴더');
    assert.equal(await operations.rename(folder.toString()), 1);
    assert.equal(await exists(folder), false);
    assert.equal(await fs.readFile(uri(renamedFolder, '세 단계/파일.txt').fsPath, 'utf8'), 'folder content');
    await assert.rejects(operations.rename(root.toString()), /루트/);
    const caseFile = uri(source, 'Case.TXT');
    await fs.writeFile(caseFile.fsPath, 'case-only');
    names.push('case.txt');
    assert.equal(await operations.rename(caseFile.toString()), 1);
    assert.equal(await fs.readFile(uri(source, 'case.txt').fsPath, 'utf8'), 'case-only');
    const trashed = uri(source, 'FinderView-test-trash-' + randomUUID() + '.txt');
    await fs.writeFile(trashed.fsPath, 'temporary test only');
    allowTrash = true;
    assert.equal(await operations.trash([trashed.toString()]), 1);
    assert.equal(await exists(trashed), false, 'Confirmed delete must remove the temporary fixture item');
    allowTrash = false;

    // Renaming an existing destination to an ancestor must never delete the source.
    const outer = uri(source, '상위 교체 방지');
    const inner = uri(outer, '원본 포함 폴더');
    await fs.mkdir(inner.fsPath, { recursive: true });
    const nestedSource = uri(inner, '같은 이름.txt');
    await fs.writeFile(nestedSource.fsPath, 'source inside ancestor');
    await fs.writeFile(uri(outer, '같은 이름.txt').fsPath, 'collision outside');
    choices.push('rename', 'overwrite'); names.push('원본 포함 폴더');
    await assert.rejects(operations.transfer([nestedSource.toString()], outer.toString()));
    assert.equal(await fs.readFile(nestedSource.fsPath, 'utf8'), 'source inside ancestor');
    assert.equal(await fs.readFile(uri(outer, '같은 이름.txt').fsPath, 'utf8'), 'collision outside');

    const upload = await operations.startUpload(target.toString());
    await operations.upload(upload, '추가한 폴더', undefined, undefined, true);
    await operations.upload(upload, '추가한 폴더/빈 폴더', undefined, undefined, true);
    await operations.upload(upload, '추가한 폴더/새 문서 # %.pdf', binary.subarray(0, 3).toString('base64'), 0);
    await operations.upload(upload, '추가한 폴더/새 문서 # %.pdf', binary.subarray(3).toString('base64'), 3);
    await operations.upload(upload, '빈 파일.txt', '', 0);
    assert.equal(await exists(uri(target, '추가한 폴더')), false, 'Partial uploads must not appear in destination');
    assert.equal(await operations.finishUpload(upload), 2);
    assert.deepEqual(await fs.readFile(uri(target, '추가한 폴더/새 문서 # %.pdf').fsPath), binary);
    assert.equal(await exists(uri(target, '추가한 폴더/빈 폴더')), true);
    assert.equal((await fs.stat(uri(target, '빈 파일.txt').fsPath)).size, 0);

    const duplicateUpload = await operations.startUpload(target.toString());
    await operations.upload(duplicateUpload, '충돌.txt', Buffer.from('uploaded new data').toString('base64'), 0);
    choices.push('rename'); names.push('업로드 충돌 해결.txt');
    assert.equal(await operations.finishUpload(duplicateUpload), 1);
    assert.equal(await fs.readFile(uri(target, '업로드 충돌 해결.txt').fsPath, 'utf8'), 'uploaded new data');
    assert.equal(await fs.readFile(old.fsPath, 'utf8'), 'new contents');

    const rejected = await operations.startUpload(target.toString());
    for (const invalid of ['../escape.txt', '/absolute.txt', 'a/../escape.txt', 'a//b.txt', 'a\\b.txt', 'a\0b.txt']) {
      await assert.rejects(operations.upload(rejected, invalid, 'YQ==', 0), /경로/);
    }
    await assert.rejects(operations.upload(rejected, 'ordered.bin', 'YQ==', 1), /순서/);
    await assert.rejects(operations.upload(rejected, 'bad.bin', '#invalid', 0), /데이터/);
    await operations.upload(rejected, 'ordered.bin', 'YQ==', 0);
    await assert.rejects(operations.upload(rejected, 'ordered.bin', 'Yg==', 0), /순서/);
    await operations.cancelUpload(rejected);
    await assert.rejects(operations.finishUpload(rejected), /만료/);
    assert.equal(await exists(uri(target, 'ordered.bin')), false, 'Canceled uploads must not publish staged content');
    const sessions = [];
    for (let index = 0; index < 4; index++) sessions.push(await operations.startUpload(target.toString()));
    await assert.rejects(operations.startUpload(target.toString()), /먼저/);
    for (const session of sessions) await operations.cancelUpload(session);

    assert.equal(choices.length, 0, 'All scripted conflict prompts must be consumed');
    assert.equal(names.length, 0, 'All scripted rename prompts must be consumed');
    console.log('PASS FileOperations: binary copy/move, multi-selection deduplication, nested folders, boundary/root/descendant/ancestor guards, file/folder rename, case-only rename, skip/cancel/rename/overwrite collisions, confirmed Trash, staged chunk imports, Unicode paths, empty files/directories, traversal and ordering validation');
  } finally {
    operations.dispose();
    await fs.rm(fixture.fsPath, { recursive: true, force: true });
  }
};
