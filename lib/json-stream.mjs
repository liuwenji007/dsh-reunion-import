/**
 * Incremental, memory-bounded JSON walker for huge documents. Holds only one
 * captured value (bounded by `maxValueChars`) and one decoded text chunk at a
 * time, while reporting structure and fully parsed array items.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_VALUE_CHARS = 8 * 1024 * 1024;
const MAX_STRUCTURAL_DEPTH = 256;
const MAX_KEYS = 64;
const READ_CHUNK_SIZE = 64 * 1024;

/**
 * @typedef {{ readonly path: readonly (string|number)[], kind: 'object'|'array'|'string'|'number'|'boolean'|'null',
 *             keys?: readonly string[], length?: number, value?: unknown, truncated?: boolean }} JsonNode
 */

/** Error raised by the walker, carrying a stable `code` and a character `offset`. */
export class JsonStreamError extends Error {
  /**
   * @param {'ABORTED'|'SYNTAX'|'TRAILING'|'TOO_DEEP'|'TOO_LARGE'} code Failure category.
   * @param {string} message Human-readable description.
   * @param {number} offset Character offset into the decoded document stream.
   */
  constructor(code, message, offset) {
    super(message);
    this.name = 'JsonStreamError';
    this.code = code;
    this.offset = offset;
  }
}

/**
 * Walk a JSON document incrementally.
 *
 * A string source is a file path when it names an existing regular file, else
 * JSON text. Bytes are strict UTF-8 with a leading BOM ignored. `onNode` runs
 * once per reported node after it completes. Array elements streamed at depths
 * below `maxDepth` go to `onArrayItem` (not `onNode`) with their own path; an
 * element over `maxValueChars` is skipped, reported truncated, and not
 * delivered. Callbacks are synchronous; returned promises are ignored.
 *
 * @param {string | Uint8Array | import('node:stream').Readable} source File path, JSON text/bytes, or readable stream.
 * @param {{ maxDepth?: number, maxValueChars?: number, maxArrayItems?: number, signal?: AbortSignal }} [options] Walk limits.
 * @param {{ onNode(node: JsonNode): void,
 *           onArrayItem?(path: readonly (string|number)[], item: unknown, index: number): boolean | void }} handler Reports.
 * @returns {Promise<void>} Resolves after the document has been walked.
 */
export async function walkJson(source, options, handler) {
  const opts = options ?? {};
  if (!handler || typeof handler.onNode !== 'function') throw new TypeError('handler.onNode must be a function');
  if (handler.onArrayItem !== undefined && typeof handler.onArrayItem !== 'function') {
    throw new TypeError('handler.onArrayItem must be a function when provided');
  }
  if (opts.signal !== undefined && (opts.signal === null || typeof opts.signal.aborted !== 'boolean')) {
    throw new TypeError('options.signal must be an AbortSignal');
  }
  const walker = new JsonWalker(source, {
    maxDepth: readLimit(opts.maxDepth, DEFAULT_MAX_DEPTH, 'maxDepth'),
    maxValueChars: readLimit(opts.maxValueChars, DEFAULT_MAX_VALUE_CHARS, 'maxValueChars'),
    maxArrayItems: readLimit(opts.maxArrayItems, Infinity, 'maxArrayItems', true),
    signal: opts.signal,
  }, handler);
  await walker.run();
}

function readLimit(value, fallback, name, allowInfinity = false) {
  if (value === undefined) return fallback;
  if (allowInfinity && value === Infinity) return Infinity;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer${allowInfinity ? ' or Infinity' : ''}`);
  }
  return value;
}

function isExistingFile(source) {
  if (typeof source !== 'string' || source.length === 0 || source.length > 4096 || source.includes('\n')) return false;
  try {
    return existsSync(source) && statSync(source).isFile();
  } catch {
    return false;
  }
}

/** Decode UTF-8 chunks, preserving sequences split across chunk boundaries. */
async function* decodeByteChunks(chunks) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let decodedChars = 0;
  for await (const chunk of chunks) {
    if (typeof chunk === 'string') {
      if (chunk.length === 0) continue;
      decodedChars += chunk.length;
      yield chunk;
      continue;
    }
    if (!(chunk instanceof Uint8Array)) throw new TypeError('Readable chunks must be strings or Uint8Array');
    let text;
    try { text = decoder.decode(chunk, { stream: true }); }
    catch { throw new JsonStreamError('SYNTAX', 'Input is not valid UTF-8', decodedChars); }
    if (text.length === 0) continue;
    decodedChars += text.length;
    yield text;
  }
  let tail;
  try { tail = decoder.decode(); }
  catch { throw new JsonStreamError('SYNTAX', 'Input is not valid UTF-8', decodedChars); }
  if (tail.length > 0) yield tail;
}

/** Yield bounded slices of a byte buffer. */
async function* byteSlices(bytes) {
  for (let offset = 0; offset < bytes.length; offset += READ_CHUNK_SIZE) {
    yield bytes.subarray(offset, Math.min(offset + READ_CHUNK_SIZE, bytes.length));
  }
}

/** Turn any supported source into a stream of decoded text chunks. */
async function* textChunks(source) {
  if (typeof source === 'string') {
    if (isExistingFile(source)) {
      yield* decodeByteChunks(createReadStream(source, { highWaterMark: READ_CHUNK_SIZE }));
      return;
    }
    let text = source;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    for (let offset = 0; offset < text.length; offset += READ_CHUNK_SIZE) {
      yield text.slice(offset, Math.min(offset + READ_CHUNK_SIZE, text.length));
    }
    return;
  }
  if (source instanceof Uint8Array) {
    yield* decodeByteChunks(byteSlices(source));
    return;
  }
  if (source && typeof source[Symbol.asyncIterator] === 'function') {
    yield* decodeByteChunks(source);
    return;
  }
  throw new TypeError('source must be a file path, a JSON string, a Uint8Array, or a Readable');
}

function kindFromChar(char) {
  if (char === '{') return 'object';
  if (char === '[') return 'array';
  if (char === '"') return 'string';
  if (char === 't' || char === 'f') return 'boolean';
  if (char === 'n') return 'null';
  if (char === '-' || (char >= '0' && char <= '9')) return 'number';
  return null;
}

const isWhitespaceCode = (code) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const isNumberDelimiterCode = (code) => isWhitespaceCode(code) || code === 0x2c || code === 0x5d || code === 0x7d;
const isHexCode = (code) =>
  (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66);

/** Single-pass incremental parser/walker state. */
class JsonWalker {
  constructor(source, options, handler) {
    this.source = source;
    this.maxDepth = options.maxDepth;
    this.maxValueChars = options.maxValueChars;
    this.maxArrayItems = options.maxArrayItems;
    this.signal = options.signal;
    this.handler = handler;
    this.iterator = null;
    this.buf = '';
    this.pos = this.base = 0;
    this.eof = this.bomChecked = false;
    this.nesting = 0;
    this.capture = null;
  }
  async run() {
    this.iterator = textChunks(this.source)[Symbol.asyncIterator]();
    try {
      this.checkAbort();
      await this.skipWhitespace();
      if (await this.peek() === '') throw new JsonStreamError('SYNTAX', 'Unexpected end of JSON input', this.offset());
      await this.parseValue([], 0);
      await this.skipWhitespace();
      if (await this.peek() !== '') {
        throw new JsonStreamError('TRAILING', 'Unexpected content after the JSON value', this.offset());
      }
    } finally {
      const iterator = this.iterator;
      this.iterator = null;
      if (iterator && typeof iterator.return === 'function') {
        try { await iterator.return(); } catch { /* Closing is best-effort after a failure. */ }
      }
    }
  }
  offset() {
    return this.base + this.pos;
  }
  checkAbort() {
    if (!this.signal || !this.signal.aborted) return;
    const reason = this.signal.reason;
    const detail = reason == null ? '' : `: ${reason instanceof Error ? reason.message : String(reason)}`;
    throw new JsonStreamError('ABORTED', `JSON walk aborted${detail}`, this.offset());
  }
  /** Pull the next text chunk when the buffer is exhausted. @returns {Promise<boolean>} */
  async fill() {
    if (this.eof) return false;
    this.checkAbort();
    this.captureFlush();
    for (;;) {
      let result;
      try { result = await this.iterator.next(); } catch (error) { this.eof = true; throw error; }
      this.checkAbort();
      if (result.done) { this.eof = true; return false; }
      if (typeof result.value !== 'string' || result.value.length === 0) continue;
      this.base += this.buf.length;
      this.buf = result.value;
      this.pos = 0;
      if (this.capture) this.capture.from = 0;
      if (!this.bomChecked) {
        this.bomChecked = true;
        if (this.buf.charCodeAt(0) === 0xfeff) this.buf = this.buf.slice(1);
      }
      if (this.buf.length > 0) return true;
    }
  }
  async peek() {
    if (this.pos < this.buf.length) return this.buf[this.pos];
    return (await this.fill()) ? this.buf[this.pos] : '';
  }
  async read() {
    if (this.pos >= this.buf.length && !(await this.fill())) return '';
    return this.buf[this.pos++];
  }
  async skipWhitespace() {
    for (;;) {
      const buf = this.buf;
      let pos = this.pos;
      while (pos < buf.length && isWhitespaceCode(buf.charCodeAt(pos))) pos++;
      this.pos = pos;
      if (pos < buf.length || !(await this.fill())) return;
    }
  }
  startCapture() {
    this.capture = { start: this.offset(), parts: [], len: 0, from: this.pos, overflow: false };
  }
  /** Append consumed buffer text to the active capture, dropping it once over budget. */
  captureFlush() {
    const capture = this.capture;
    if (!capture) return;
    const piece = this.buf.slice(capture.from, this.pos);
    capture.from = this.pos;
    if (capture.overflow) return;
    if (capture.len + piece.length > this.maxValueChars) {
      capture.overflow = true;
      capture.parts.length = 0;
    } else if (piece.length > 0) {
      capture.parts.push(piece);
      capture.len += piece.length;
    }
  }
  endCapture() {
    const capture = this.capture;
    if (!capture) return { raw: '', overflow: false, start: this.offset() };
    this.captureFlush();
    this.capture = null;
    if (capture.overflow) return { raw: null, overflow: true, start: capture.start };
    return { raw: capture.parts.join(''), overflow: false, start: capture.start };
  }
  /** Capture and validate one complete JSON value at the cursor. */
  async captureValue() {
    const start = this.offset();
    const char = await this.peek();
    const kind = kindFromChar(char);
    if (char === '') throw new JsonStreamError('SYNTAX', 'Unexpected end of JSON input', start);
    if (kind === null) throw new JsonStreamError('SYNTAX', `Unexpected character ${JSON.stringify(char)}`, start);
    this.startCapture();
    try { await this.skipValue(); } catch (error) { this.capture = null; throw error; }
    const capture = this.endCapture();
    return { raw: capture.raw, overflow: capture.overflow, kind, start };
  }
  parseRaw(raw, start) {
    try { return JSON.parse(raw); }
    catch { throw new JsonStreamError('SYNTAX', 'Invalid JSON value', start); }
  }
  enterNesting() {
    this.nesting++;
    if (this.nesting > MAX_STRUCTURAL_DEPTH) {
      throw new JsonStreamError('TOO_DEEP', `Document nesting exceeds ${MAX_STRUCTURAL_DEPTH} levels`, this.offset());
    }
  }
  emitNode(node) {
    this.handler.onNode({ ...node, path: node.path.slice() });
  }
  /** Walk a value, capturing it whole once `maxDepth` is reached. */
  async parseValue(path, depth) {
    this.checkAbort();
    const char = await this.peek();
    if (char === '') throw new JsonStreamError('SYNTAX', 'Unexpected end of JSON input', this.offset());
    if (depth === this.maxDepth) {
      const capture = await this.captureValue();
      if (!capture.overflow) this.emitNode({ path, kind: capture.kind, value: this.parseRaw(capture.raw, capture.start) });
      // The root value has no safe truncation channel; deeper nodes can be skipped.
      else if (depth === 0) {
        throw new JsonStreamError('TOO_LARGE', `Top-level value exceeds maxValueChars (${this.maxValueChars})`, capture.start);
      } else this.emitNode({ path, kind: capture.kind, truncated: true });
      return;
    }
    if (char === '{') return this.scanObject(path, depth, true);
    if (char === '[') return this.scanArray(path, depth, true);
    const kind = kindFromChar(char);
    if (kind === null) throw new JsonStreamError('SYNTAX', `Unexpected character ${JSON.stringify(char)}`, this.offset());
    const capture = await this.captureValue();
    if (capture.overflow) {
      throw new JsonStreamError('TOO_LARGE', `Scalar value exceeds maxValueChars (${this.maxValueChars})`, capture.start);
    }
    this.emitNode({ path, kind: capture.kind, value: this.parseRaw(capture.raw, capture.start) });
  }
  /** Walk (`walk === true`) or validate-and-skip an object. */
  async scanObject(path, depth, walk) {
    this.enterNesting();
    try {
      this.pos++;
      const keys = [];
      let keyCount = 0;
      await this.skipWhitespace();
      if (await this.peek() === '}') this.pos++;
      else {
        for (;;) {
          this.checkAbort();
          if (await this.peek() !== '"') throw new JsonStreamError('SYNTAX', 'Expected a string key', this.offset());
          let key;
          if (walk) {
            const keyStart = this.offset();
            this.startCapture();
            try { await this.skipString(); } catch (error) { this.capture = null; throw error; }
            const keyCapture = this.endCapture();
            if (keyCapture.overflow) {
              throw new JsonStreamError('TOO_LARGE', `Object key exceeds maxValueChars (${this.maxValueChars})`, keyStart);
            }
            key = this.parseRaw(keyCapture.raw, keyStart);
            keyCount++;
            if (keys.length < MAX_KEYS) keys.push(key);
          } else {
            await this.skipString();
          }
          await this.skipWhitespace();
          if (await this.peek() !== ':') throw new JsonStreamError('SYNTAX', 'Expected ":" after key', this.offset());
          this.pos++;
          await this.skipWhitespace();
          if (walk) await this.parseValue(path.concat(key), depth + 1);
          else await this.skipValue();
          await this.skipWhitespace();
          const separator = await this.peek();
          if (separator === ',') { this.pos++; await this.skipWhitespace(); continue; }
          if (separator === '}') { this.pos++; break; }
          throw new JsonStreamError('SYNTAX', 'Expected "," or "}" in object', this.offset());
        }
      }
      if (!walk) return;
      const node = { path, kind: 'object', keys };
      if (keyCount > keys.length) node.truncated = true;
      this.emitNode(node);
    } finally {
      this.nesting--;
    }
  }
  /** Walk (`walk === true`, streaming items) or validate-and-skip an array. */
  async scanArray(path, depth, walk) {
    this.enterNesting();
    try {
      this.pos++;
      let length = 0;
      let deliver = true;
      await this.skipWhitespace();
      if (await this.peek() === ']') this.pos++;
      else {
        for (;;) {
          this.checkAbort();
          const index = length;
          if (!walk || !deliver || index >= this.maxArrayItems) {
            await this.skipValue();
          } else if (kindFromChar(await this.peek()) === null) {
            throw new JsonStreamError('SYNTAX', 'Unexpected character in array', this.offset());
          } else {
            const capture = await this.captureValue();
            if (capture.overflow) {
              this.emitNode({ path: path.concat(index), kind: capture.kind, truncated: true });
            } else {
              const item = this.parseRaw(capture.raw, capture.start);
              if (typeof this.handler.onArrayItem === 'function'
                && this.handler.onArrayItem(path.concat(index), item, index) === false) deliver = false;
            }
          }
          length++;
          await this.skipWhitespace();
          const separator = await this.peek();
          if (separator === ',') { this.pos++; await this.skipWhitespace(); continue; }
          if (separator === ']') { this.pos++; break; }
          throw new JsonStreamError('SYNTAX', 'Expected "," or "]" in array', this.offset());
        }
      }
      if (walk) this.emitNode({ path, kind: 'array', length });
    } finally {
      this.nesting--;
    }
  }
  async skipValue() {
    const char = await this.peek();
    switch (char) {
      case '': throw new JsonStreamError('SYNTAX', 'Unexpected end of JSON input', this.offset());
      case '{': return this.scanObject([], 0, false);
      case '[': return this.scanArray([], 0, false);
      case '"': return this.skipString();
      case 't': return this.skipLiteral('true');
      case 'f': return this.skipLiteral('false');
      case 'n': return this.skipLiteral('null');
      default:
        if (char === '-' || (char >= '0' && char <= '9')) return this.skipNumber();
        throw new JsonStreamError('SYNTAX', `Unexpected character ${JSON.stringify(char)}`, this.offset());
    }
  }
  async skipString() {
    const start = this.offset();
    this.pos++;
    for (;;) {
      if (this.pos >= this.buf.length && !(await this.fill())) {
        throw new JsonStreamError('SYNTAX', 'Unterminated string', start);
      }
      const buf = this.buf;
      let pos = this.pos;
      let escaped = false;
      while (pos < buf.length) {
        const code = buf.charCodeAt(pos);
        if (code === 0x22) { this.pos = pos + 1; return; }
        if (code === 0x5c) { escaped = true; break; }
        if (code < 0x20) throw new JsonStreamError('SYNTAX', 'Unescaped control character in string', this.base + pos);
        pos++;
      }
      if (!escaped) { this.pos = buf.length; continue; }
      this.pos = pos + 1;
      const escape = await this.read();
      if (escape === '') throw new JsonStreamError('SYNTAX', 'Unterminated string', start);
      if (escape === 'u') {
        for (let index = 0; index < 4; index++) {
          const digit = await this.read();
          if (digit === '' || !isHexCode(digit.charCodeAt(0))) {
            throw new JsonStreamError('SYNTAX', 'Invalid unicode escape in string', this.offset());
          }
        }
      } else if (!'"\\/bfnrt'.includes(escape)) {
        throw new JsonStreamError('SYNTAX', 'Invalid escape sequence in string', this.offset());
      }
    }
  }
  async skipLiteral(word) {
    for (let index = 0; index < word.length; index++) {
      if (await this.read() !== word[index]) {
        throw new JsonStreamError('SYNTAX', `Invalid literal; expected "${word}"`, this.offset());
      }
    }
  }
  async skipNumber() {
    let state = 0;
    for (;;) {
      if (this.pos >= this.buf.length && !(await this.fill())) break;
      const buf = this.buf;
      const len = buf.length;
      let pos = this.pos;
      let done = false;
      while (pos < len) {
        const code = buf.charCodeAt(pos);
        let next = -1;
        switch (state) {
          case 0:
            if (code === 0x2d) next = 1; else if (code === 0x30) next = 2;
            else if (code >= 0x31 && code <= 0x39) next = 3;
            break;
          case 1:
            if (code === 0x30) next = 2; else if (code >= 0x31 && code <= 0x39) next = 3;
            break;
          case 2:
            if (code === 0x2e) next = 4; else if (code === 0x65 || code === 0x45) next = 6;
            else if (isNumberDelimiterCode(code)) done = true;
            break;
          case 3:
            if (code >= 0x30 && code <= 0x39) next = 3; else if (code === 0x2e) next = 4;
            else if (code === 0x65 || code === 0x45) next = 6;
            else if (isNumberDelimiterCode(code)) done = true;
            break;
          case 4:
            if (code >= 0x30 && code <= 0x39) next = 5;
            break;
          case 5:
            if (code >= 0x30 && code <= 0x39) next = 5;
            else if (code === 0x65 || code === 0x45) next = 6;
            else if (isNumberDelimiterCode(code)) done = true;
            break;
          case 6:
            if (code === 0x2b || code === 0x2d) next = 7;
            else if (code >= 0x30 && code <= 0x39) next = 8;
            break;
          case 7:
            if (code >= 0x30 && code <= 0x39) next = 8;
            break;
          default:
            if (code >= 0x30 && code <= 0x39) next = 8;
            else if (isNumberDelimiterCode(code)) done = true;
            break;
        }
        if (done) { this.pos = pos; return; }
        if (next < 0) throw new JsonStreamError('SYNTAX', 'Invalid number', this.base + pos);
        state = next;
        pos++;
      }
      this.pos = len;
    }
    if (state !== 2 && state !== 3 && state !== 5 && state !== 8) {
      throw new JsonStreamError('SYNTAX', 'Invalid number', this.offset());
    }
  }
}
