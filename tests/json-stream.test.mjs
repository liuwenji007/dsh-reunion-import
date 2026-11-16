import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { JsonStreamError, walkJson } from '../lib/json-stream.mjs';

/** @type {string | undefined} */
let tempDir;

after(async () => {
  if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
});

/** @returns {Promise<string>} A fresh temporary directory. */
async function temp() {
  tempDir ??= await mkdtemp(join(tmpdir(), 'dsh-json-stream-'));
  return tempDir;
}

/**
 * Walk `source` and collect reports.
 * @param {any} source Walk source.
 * @param {object} [options] Walk options.
 * @returns {Promise<{ nodes: any[], items: { path: any[], item: any, index: number }[] }>} Collected reports.
 */
async function collect(source, options = {}) {
  const nodes = [];
  const items = [];
  await walkJson(source, options, {
    onNode(node) {
      nodes.push({ ...node, path: [...node.path] });
    },
    onArrayItem(path, item, index) {
      items.push({ path: [...path], item, index });
    },
  });
  return { nodes, items };
}

test('small document from a string reports exact kinds, paths, values, keys, and lengths', async () => {
  const doc = {
    name: '重逢 😀',
    count: 3,
    ratio: 1.5,
    active: true,
    nothing: null,
    tags: ['a', 'b'],
    nested: { x: 1, deeper: { y: [true, false] } },
    items: [10, 20, 30],
  };
  const { nodes, items } = await collect(JSON.stringify(doc));

  assert.deepEqual(nodes, [
    { path: ['name'], kind: 'string', value: '重逢 😀' },
    { path: ['count'], kind: 'number', value: 3 },
    { path: ['ratio'], kind: 'number', value: 1.5 },
    { path: ['active'], kind: 'boolean', value: true },
    { path: ['nothing'], kind: 'null', value: null },
    { path: ['tags'], kind: 'array', length: 2 },
    { path: ['nested', 'x'], kind: 'number', value: 1 },
    { path: ['nested', 'deeper', 'y'], kind: 'array', length: 2 },
    { path: ['nested', 'deeper'], kind: 'object', keys: ['y'] },
    { path: ['nested'], kind: 'object', keys: ['x', 'deeper'] },
    { path: ['items'], kind: 'array', length: 3 },
    {
      path: [],
      kind: 'object',
      keys: ['name', 'count', 'ratio', 'active', 'nothing', 'tags', 'nested', 'items'],
    },
  ]);

  assert.deepEqual(items, [
    { path: ['tags', 0], item: 'a', index: 0 },
    { path: ['tags', 1], item: 'b', index: 1 },
    { path: ['nested', 'deeper', 'y', 0], item: true, index: 0 },
    { path: ['nested', 'deeper', 'y', 1], item: false, index: 1 },
    { path: ['items', 0], item: 10, index: 0 },
    { path: ['items', 1], item: 20, index: 1 },
    { path: ['items', 2], item: 30, index: 2 },
  ]);
});

test('object nodes cap keys at 64 and mark truncation', async () => {
  const doc = {};
  for (let index = 0; index < 70; index++) doc[`key${index}`] = index;
  const { nodes } = await collect(JSON.stringify(doc), { maxDepth: 1 });
  const root = nodes.at(-1);
  assert.equal(root.kind, 'object');
  assert.equal(root.keys.length, 64);
  assert.equal(root.truncated, true);
  assert.equal(root.path.length, 0);
});

test('a file path source produces the same reports as the JSON text', async () => {
  const dir = await temp();
  const json = JSON.stringify({ users: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }], total: 2 });
  const file = join(dir, 'doc.json');
  await writeFile(file, json, 'utf8');

  const fromFile = await collect(file);
  const fromText = await collect(json);
  assert.deepEqual(fromFile, fromText);
  assert.deepEqual(fromFile.items.map((entry) => entry.item), [
    { id: 1, name: '甲' },
    { id: 2, name: '乙' },
  ]);
});

test('a UTF-8 BOM is accepted for file and byte sources', async () => {
  const dir = await temp();
  const body = '{"a":1}';
  const bomBytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(body, 'utf8')]);
  const file = join(dir, 'bom.json');
  await writeFile(file, bomBytes);

  for (const source of [`\uFEFF${body}`, bomBytes, file]) {
    const { nodes } = await collect(source);
    assert.deepEqual(nodes, [
      { path: ['a'], kind: 'number', value: 1 },
      { path: [], kind: 'object', keys: ['a'] },
    ]);
  }
});

test('a Readable fed in 1-byte chunks handles split multi-byte characters', async () => {
  const json = JSON.stringify({ greeting: '重逢 😀', values: ['é', '🚀'] });
  const bytes = Buffer.from(json, 'utf8');
  async function* oneByteAtATime() {
    for (const byte of bytes) yield Uint8Array.of(byte);
  }
  const fromChunks = await collect(Readable.from(oneByteAtATime()));
  const fromWhole = await collect(json);
  assert.deepEqual(fromChunks, fromWhole);
  assert.equal(fromChunks.nodes[0].value, '重逢 😀');
  assert.deepEqual(fromChunks.items.map((entry) => entry.item), ['é', '🚀']);
});

test('300k array items are all delivered and maxArrayItems caps delivery only', async () => {
  const count = 300_000;
  const json = `[${Array.from({ length: count }, (_, index) => index).join(',')}]`;

  let delivered = 0;
  let sum = 0;
  let lastIndex = -1;
  let arrayLength = -1;
  await walkJson(json, {}, {
    onNode(node) {
      if (node.kind === 'array') arrayLength = node.length;
    },
    onArrayItem(_path, item, index) {
      delivered++;
      sum += item;
      lastIndex = index;
    },
  });
  assert.equal(delivered, count);
  assert.equal(sum, (count * (count - 1)) / 2);
  assert.equal(lastIndex, count - 1);
  assert.equal(arrayLength, count);

  let capped = 0;
  let cappedLength = -1;
  await walkJson(json, { maxArrayItems: 1000 }, {
    onNode(node) {
      if (node.kind === 'array') cappedLength = node.length;
    },
    onArrayItem() {
      capped++;
    },
  });
  assert.equal(capped, 1000);
  assert.equal(cappedLength, count);
});

test('an oversized array item is skipped with a truncated node report and the walk continues', async () => {
  const json = JSON.stringify([1, 'x'.repeat(200), { a: 'y'.repeat(100) }, 4]);
  const { nodes, items } = await collect(json, { maxValueChars: 50 });

  assert.deepEqual(items.map((entry) => [entry.index, entry.item]), [[0, 1], [3, 4]]);
  const truncated = nodes.filter((node) => node.truncated === true);
  assert.deepEqual(truncated, [
    { path: [1], kind: 'string', truncated: true },
    { path: [2], kind: 'object', truncated: true },
  ]);
  assert.deepEqual(nodes.filter((node) => node.kind === 'array'), [{ path: [], kind: 'array', length: 4 }]);
});

test('maxDepth captures a whole subtree without descending further', async () => {
  const doc = { a: { b: { c: { d: { e: { f: 1 } } } } } };
  const { nodes } = await collect(JSON.stringify(doc), { maxDepth: 3 });
  const depthLimited = nodes.find((node) => node.path.join('.') === 'a.b.c');
  assert.deepEqual(depthLimited, {
    path: ['a', 'b', 'c'],
    kind: 'object',
    value: { d: { e: { f: 1 } } },
  });
  assert.equal(nodes.some((node) => node.path.length > 3), false);

  const { nodes: truncatedNodes } = await collect(JSON.stringify(doc), { maxDepth: 3, maxValueChars: 10 });
  const truncated = truncatedNodes.find((node) => node.path.join('.') === 'a.b.c');
  assert.deepEqual(truncated, { path: ['a', 'b', 'c'], kind: 'object', truncated: true });
  assert.equal(truncatedNodes.some((node) => node.path.length > 3), false);
});

test('malformed JSON rejects with SYNTAX and a plausible offset', async () => {
  const cases = ['{"a": }', '[1,2,]', '{"a" 1}', '[1, 2', 'tru', '"unterminated', '{"a":01}', '[1e]'];
  for (const json of cases) {
    await assert.rejects(
      collect(json),
      (error) => {
        assert.equal(error instanceof JsonStreamError, true, `expected JsonStreamError for ${json}`);
        assert.equal(error.code, 'SYNTAX', `expected SYNTAX for ${json}, got ${error.code}`);
        assert.equal(typeof error.offset, 'number');
        assert.equal(Number.isInteger(error.offset) && error.offset >= 0, true);
        return true;
      },
    );
  }
});

test('trailing content rejects with TRAILING', async () => {
  await assert.rejects(collect('{} x'), (error) => {
    assert.equal(error instanceof JsonStreamError, true);
    assert.equal(error.code, 'TRAILING');
    assert.equal(typeof error.offset, 'number');
    return true;
  });
});

test('documents nested deeper than 256 reject with TOO_DEEP', async () => {
  const json = `${'['.repeat(300)}1${']'.repeat(300)}`;
  await assert.rejects(collect(json), (error) => {
    assert.equal(error instanceof JsonStreamError, true);
    assert.equal(error.code, 'TOO_DEEP');
    return true;
  });
});

test('an oversized top-level scalar rejects with TOO_LARGE', async () => {
  await assert.rejects(collect(JSON.stringify('x'.repeat(100)), { maxValueChars: 10 }), (error) => {
    assert.equal(error instanceof JsonStreamError, true);
    assert.equal(error.code, 'TOO_LARGE');
    return true;
  });
});

test('an aborted signal rejects with ABORTED, before and between chunks', async () => {
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(collect('[1,2,3]', { signal: preAborted.signal }), (error) => {
    assert.equal(error instanceof JsonStreamError, true);
    assert.equal(error.code, 'ABORTED');
    return true;
  });

  const midStream = new AbortController();
  async function* chunks() {
    yield '[';
    midStream.abort(new Error('stop now'));
    yield '1]';
  }
  await assert.rejects(collect(Readable.from(chunks()), { signal: midStream.signal }), (error) => {
    assert.equal(error instanceof JsonStreamError, true);
    assert.equal(error.code, 'ABORTED');
    assert.match(error.message, /stop now/);
    return true;
  });
});

test('onArrayItem returning false skips the rest but keeps the full length', async () => {
  const delivered = [];
  let arrayLength = -1;
  await walkJson('[0,1,2,3,4]', {}, {
    onNode(node) {
      if (node.kind === 'array') arrayLength = node.length;
    },
    onArrayItem(path, item, index) {
      delivered.push({ path: [...path], item, index });
      if (index === 1) return false;
    },
  });
  assert.deepEqual(delivered, [
    { path: [0], item: 0, index: 0 },
    { path: [1], item: 1, index: 1 },
  ]);
  assert.equal(arrayLength, 5);
});

test('20 MB array file walk completes with counts only', { timeout: 120_000 }, async () => {
  const dir = await temp();
  const file = join(dir, 'large.json');
  const itemCount = 20_000;
  const payload = 'z'.repeat(900);
  const parts = Array.from({ length: itemCount }, (_, index) =>
    JSON.stringify({ id: index, text: payload, nested: { ok: index % 2 === 0 } }));
  await writeFile(file, `[${parts.join(',')}]`, 'utf8');
  const size = (await readFile(file)).byteLength;
  assert.ok(size > 18 * 1024 * 1024, `expected a ~20 MB file, got ${size} bytes`);

  let items = 0;
  let arrayLength = -1;
  let firstId = -1;
  let lastId = -1;
  await walkJson(file, {}, {
    onNode(node) {
      if (node.kind === 'array') arrayLength = node.length;
    },
    onArrayItem(_path, item) {
      items++;
      if (firstId === -1) firstId = item.id;
      lastId = item.id;
    },
  });
  assert.equal(items, itemCount);
  assert.equal(arrayLength, itemCount);
  assert.equal(firstId, 0);
  assert.equal(lastId, itemCount - 1);
});
