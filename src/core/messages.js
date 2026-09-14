'use strict';

const crypto = require('node:crypto');
const { publicMessage } = require('./events');
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}
function createMessageStore(config, now) {
  const dedupe = new Map();
  function imageMagicMatches(mime, bytes) {
    if (mime === 'image/png') return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (mime === 'image/gif') return bytes.length >= 10 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a');
    return mime === 'image/webp' && bytes.length >= 16 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  }

  function encodedImageDimensions(mime, bytes) {
    if (mime === 'image/png' && bytes.length >= 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === 'image/gif' && bytes.length >= 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (mime === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
        if (offset + 4 > bytes.length) break;
        const length = bytes.readUInt16BE(offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) return null;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
          return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
        }
        offset += 2 + length;
      }
      return null;
    }
    if (mime === 'image/webp' && bytes.length >= 30) {
      const kind = bytes.subarray(12, 16).toString();
      if (kind === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
      if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
      if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    }
    return null;
  }

  function parseImage(value) {
    if (!value || typeof value !== 'object' || typeof value.src !== 'string') return null;
    const match = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.src);
    if (!match) return null;
    const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
    let decoded;
    try { decoded = Buffer.from(match[2], 'base64'); } catch { return null; }
    if (!decoded.length || decoded.length > config.maxImageBytes || !imageMagicMatches(mime, decoded)) return null;
    const claimedWidth = Number.isFinite(value.width) ? Math.round(value.width) : null;
    const claimedHeight = Number.isFinite(value.height) ? Math.round(value.height) : null;
    if (!claimedWidth || !claimedHeight || claimedWidth < 1 || claimedHeight < 1 || claimedWidth > config.maxImageDimension || claimedHeight > config.maxImageDimension) return null;
    if (claimedWidth * claimedHeight > config.maxImagePixels) return null;
    const actual = encodedImageDimensions(mime, decoded);
    if (!actual || actual.width !== claimedWidth || actual.height !== claimedHeight) return null;
    return { src: value.src, mime, width: claimedWidth, height: claimedHeight, bytes: decoded.length };
  }

  function findReply(channel, id) {
    if (typeof id !== 'string') return null;
    const original = channel.messages.find((message) => message.id === id);
    if (!original) return null;
    return {
      id: original.id,
      username: original.author.username,
      kind: original.kind,
      text: original.kind === 'text' ? original.text : '图片'
    };
  }

  function reactionSummary(message) {
    const reactions = {};
    for (const [emoji, userIds] of message.reactionUsers || []) {
      if (userIds.size) reactions[emoji] = { count: userIds.size, userIds: [...userIds] };
    }
    return reactions;
  }

  function messageByteSize(message) {
    return Buffer.byteLength(JSON.stringify(publicMessage(message)));
  }

  function pruneDedupe() {
    const cutoff = now() - config.dedupeTtlMs;
    for (const [key, value] of dedupe) {
      if (value.acceptedAt < cutoff || dedupe.size > config.maxDedupeEntries) dedupe.delete(key);
      else break;
    }
  }

  function payloadFingerprint(command, kind, text, image) {
    const hash = crypto.createHash('sha256');
    hash.update(kind);
    hash.update('\0');
    hash.update(text || image?.src || '');
    hash.update('\0');
    hash.update(typeof command.replyTo === 'string' ? command.replyTo : '');
    return hash.digest('hex');
  }

  function messageAck(message) {
    return {
      type: 'ack',
      clientMessageId: message.clientMessageId,
      messageId: message.id,
      seq: message.seq,
      createdAt: message.createdAt
    };
  }


  return { parseImage, findReply, reactionSummary, messageByteSize, pruneDedupe, payloadFingerprint, messageAck,
    previous: (key) => dedupe.get(key), remember: (key, value) => dedupe.set(key, value), clear: () => dedupe.clear() };
}
module.exports = { createMessageStore, cleanText };
