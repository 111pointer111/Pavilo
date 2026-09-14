'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DEFAULTS } = require('../config');
const { createMessageStore } = require('../src/core/messages');

function image(mime, bytes, width = 2, height = 3) {
  return { src: `data:${mime};base64,${bytes.toString('base64')}`, width, height };
}
function png() {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(2, 16);
  bytes.writeUInt32BE(3, 20);
  return bytes;
}

test('image parser preserves PNG, GIF, JPEG and WebP header dimension validation', () => {
  const { parseImage } = createMessageStore(DEFAULTS, Date.now);
  const gif = Buffer.alloc(10);
  gif.write('GIF89a'); gif.writeUInt16LE(2, 6); gif.writeUInt16LE(3, 8);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 3, 0, 2, 0]);
  const webp = Buffer.alloc(30);
  webp.write('RIFF'); webp.write('WEBP', 8); webp.write('VP8X', 12);
  webp.writeUIntLE(1, 24, 3); webp.writeUIntLE(2, 27, 3);
  for (const [mime, bytes] of [['image/png', png()], ['image/gif', gif], ['image/jpg', jpeg], ['image/webp', webp]]) {
    const input = image(mime, bytes);
    assert.deepEqual(parseImage(input), { ...input, mime: mime === 'image/jpg' ? 'image/jpeg' : mime, bytes: bytes.length });
    assert.equal(parseImage({ ...input, width: 3 }), null, 'claimed size must match encoded size');
    assert.equal(parseImage(image(mime, Buffer.from('not an image'))), null);
  }
});

test('image parser enforces byte, dimension and pixel budgets independently', () => {
  const source = image('image/png', png());
  for (const limit of [{ maxImageBytes: 23 }, { maxImageDimension: 2 }, { maxImagePixels: 5 }]) {
    assert.equal(createMessageStore({ ...DEFAULTS, ...limit }, Date.now).parseImage(source), null);
  }
  const { parseImage } = createMessageStore(DEFAULTS, Date.now);
  for (const patch of [{ src: source.src.replace('image/png', 'image/jpeg') }, { src: `${source.src}\n` }, { width: '2' }, { height: -1 }]) {
    assert.equal(parseImage({ ...source, ...patch }), null);
  }
});
