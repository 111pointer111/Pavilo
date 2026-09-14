'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const {
  createImages, positiveLimit, imageDimensions, validateSource, validateGif, encodeWithinBudget,
} = require('../client/images');

const LIMITS = { maxImageBytes: 300_000, maxImagePixels: 4_000_000, maxImageDimension: 1600 };

function mockImages({ width = 2000, height = 1000, payload = 'AAAA', readError = false, decodeError = false, noContext = false, getLimits = () => LIMITS } = {}) {
  const calls = { reads: [], sources: [], contexts: [], draws: [], encodes: [], canvases: 0 };
  class FileReader {
    addEventListener(name, handler) { this[name] = handler; }
    readAsDataURL(file) {
      calls.reads.push(file);
      this.result = 'data:' + file.type + ';base64,original';
      this[readError ? 'error' : 'load']();
    }
  }
  class Image {
    constructor() { this.naturalWidth = width; this.naturalHeight = height; }
    addEventListener(name, handler) { this[name] = handler; }
    set src(value) { calls.sources.push(value); this[decodeError ? 'error' : 'load'](); }
  }
  const canvas = {
    getContext(...args) {
      calls.contexts.push(args);
      return noContext ? null : { drawImage: (...args) => calls.draws.push(args) };
    },
    toDataURL(mime, quality) {
      calls.encodes.push([mime, quality]);
      return `data:${mime};base64,${typeof payload === 'function' ? payload(quality) : payload}`;
    },
  };
  const images = createImages({ getLimits, FileReader, Image, createCanvas() { calls.canvases += 1; return canvas; } });
  return { ...images, calls, canvas };
}

test('UMD loads without DOM access and exposes identical browser and Node APIs', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../client/images'), 'utf8'), browser);
  assert.deepEqual(Object.keys(browser.PaviloImages).sort(), Object.keys(require('../client/images')).sort());
  assert.equal(typeof browser.PaviloImages.createImages({ getLimits: () => LIMITS }).prepareImage, 'function');
});

test('positiveLimit preserves coercion, flooring, and fallback semantics', () => {
  for (const value of [undefined, null, '', 0, -1, Infinity, NaN, 'bad']) {
    assert.equal(positiveLimit(value, 12), 12);
  }
  assert.equal(positiveLimit('42.9', 12), 42);
  assert.equal(positiveLimit(true, 12), 1);
  assert.equal(positiveLimit(.9, 12), 0);
});

test('imageDimensions downsamples either orientation, rounds and never upscales', () => {
  assert.deepEqual(imageDimensions(2400, 1200), { width: 1600, height: 800 });
  assert.deepEqual(imageDimensions(1200, 2400), { width: 800, height: 1600 });
  assert.deepEqual(imageDimensions(20, 10), { width: 20, height: 10 });
  assert.deepEqual(imageDimensions(3000, 1000), { width: 1600, height: 533 });
  assert.deepEqual(imageDimensions(4000, 1), { width: 1600, height: 1 });
  assert.deepEqual(imageDimensions(2000, 1000, 800), { width: 800, height: 400 });
});

test('source validation allows common high-resolution originals but rejects unsafe dimensions', () => {
  assert.doesNotThrow(() => validateSource(4000, 3000, 32_000_000));
  for (const [width, height] of [[0, 1], [1, 0], [6000, 6000]]) {
    assert.throws(() => validateSource(width, height, 32_000_000), /^Error: too large$/);
  }
  assert.doesNotThrow(() => validateSource(2000, 2000, LIMITS.maxImagePixels));
});

test('encoding returns the initial .82 result immediately when its byte estimate fits', () => {
  const calls = [];
  const canvas = { toDataURL(mime, quality) { calls.push([mime, quality]); return 'data:image/jpeg;base64,AAAAA'; } };
  assert.deepEqual(encodeWithinBudget(canvas, 'image/jpeg', 4), { src: 'data:image/jpeg;base64,AAAAA', bytes: 4 });
  assert.deepEqual(calls, [['image/jpeg', .82]]);
});

test('encoding performs exactly four bisections and chooses a smaller .5 floor', () => {
  const calls = [];
  const canvas = { toDataURL(mime, quality) { calls.push(quality); return 'data:' + mime + ';base64,' + 'A'.repeat(Math.round(quality * 100)); } };
  const encoded = encodeWithinBudget(canvas, 'image/jpeg', 50);
  assert.equal(calls.length, 6);
  const expected = [.82, .66, .74, .70, .68, .5];
  calls.forEach((quality, index) => assert.ok(Math.abs(quality - expected[index]) < 1e-12));
  assert.equal(encoded.bytes, 38);
});

test('encoding keeps the best candidate when the floor ties, or returns an oversized floor', () => {
  const payloads = ['A'.repeat(100), 'AAAA', 'A'.repeat(80), 'A'.repeat(80), 'A'.repeat(80), 'BBBB'];
  const canvas = { toDataURL() { return 'data:image/png;base64,' + payloads.shift(); } };
  assert.deepEqual(encodeWithinBudget(canvas, 'image/png', 3), { src: 'data:image/png;base64,AAAA', bytes: 3 });
  const oversized = { toDataURL(mime, quality) { return `data:${mime};base64,${'A'.repeat(Math.round(quality * 100))}`; } };
  assert.equal(encodeWithinBudget(oversized, 'image/jpeg', 1).bytes, 38);
});

test('GIF preparation retains its original data URL and never creates a canvas', async () => {
  const images = mockImages({ width: 1600, height: 1500 });
  const file = { type: 'image/gif', size: 300_000 };
  assert.deepEqual(await images.prepareImage(file), { src: 'data:image/gif;base64,original', width: 1600, height: 1500, bytes: 300_000 });
  assert.deepEqual(images.calls.reads, [file]);
  assert.equal(images.calls.canvases, 0);
  for (const options of [{ width: 1601 }, { height: 1601 }, { width: 2001, height: 2000 }]) {
    const invalid = mockImages(options);
    await assert.rejects(invalid.prepareImage(file), /^Error: too large$/);
    assert.equal(invalid.calls.canvases, 0);
  }
  await assert.rejects(images.prepareImage({ ...file, size: 300_001 }), /^Error: too large$/);
});

test('still images downsample, draw once, and choose MIME and alpha exactly as before', async () => {
  for (const [type, size, mime, alpha] of [
    ['image/png', 300_000, 'image/png', true],
    ['image/png', 300_001, 'image/jpeg', true],
    ['image/jpeg', 10, 'image/jpeg', false],
    ['image/webp', 10, 'image/jpeg', false],
  ]) {
    const images = mockImages();
    assert.deepEqual(await images.prepareImage({ type, size }), { src: `data:${mime};base64,AAAA`, width: 1600, height: 800, bytes: 3 });
    assert.equal(images.canvas.width, 1600);
    assert.equal(images.canvas.height, 800);
    assert.deepEqual(images.calls.contexts, [['2d', { alpha }]]);
    assert.equal(images.calls.draws.length, 1);
    assert.deepEqual(images.calls.draws[0].slice(1), [0, 0, 1600, 800]);
    assert.deepEqual(images.calls.encodes, [[mime, .82]]);
  }
});

test('source validation precedes canvas work and image preparation rejects empty/unsafe originals', async () => {
  for (const options of [{ width: 0 }, { height: 0 }, { width: 6000, height: 6000 }]) {
    const images = mockImages(options);
    await assert.rejects(images.prepareImage({ type: 'image/jpeg', size: 1 }), (error) => error.code === 'SOURCE_TOO_LARGE');
    assert.equal(images.calls.canvases, 0);
  }
  for (const payload of ['', 'A'.repeat(400_001)]) {
    const images = mockImages({ payload });
    await assert.rejects(images.prepareImage({ type: 'image/jpeg', size: 1 }), (error) => error.code === 'ENCODE_TOO_LARGE');
  }
});

test('preparation reads current limits for each upload rather than caching factory limits', async () => {
  let limits = LIMITS;
  const images = mockImages({ width: 10, height: 10, getLimits: () => limits });
  await images.prepareImage({ type: 'image/jpeg', size: 1 });
  limits = { ...LIMITS, maxImageBytes: 2 };
  await assert.rejects(images.prepareImage({ type: 'image/jpeg', size: 1 }), (error) => error.code === 'ENCODE_TOO_LARGE');
});

test('reader, decoder, and canvas failures preserve error messages', async () => {
  for (const [options, message] of [[{ readError: true }, 'read failed'], [{ decodeError: true }, 'decode failed'], [{ noContext: true }, 'canvas unavailable']]) {
    const images = mockImages(options);
    await assert.rejects(images.prepareImage({ type: 'image/jpeg', size: 1 }), { message });
  }
});
