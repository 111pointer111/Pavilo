(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) module.exports = factory();
  else root.PaviloImages = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positiveLimit(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function imageDimensions(width, height, target = 1600) {
    const scale = Math.min(1, target / width, target / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }

  const MAX_SOURCE_PIXELS = 32_000_000;

  function imageError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function validateSource(width, height, maxPixels) {
    if (!width || !height || width * height > maxPixels) {
      throw imageError('SOURCE_TOO_LARGE', 'too large', { width, height, pixels: width * height, maxPixels });
    }
  }

  function validateGif(file, width, height, limits) {
    if (file.size > limits.maxImageBytes || width > limits.maxImageDimension || height > limits.maxImageDimension) {
      throw imageError('GIF_TOO_LARGE', 'too large', {
        bytes: file.size, width, height, maxBytes: limits.maxImageBytes, maxDimension: limits.maxImageDimension,
      });
    }
  }

  function constrainedDimensions(width, height, limits, scale = 1) {
    const maxDimension = positiveLimit(limits.maxImageDimension, 1600);
    const maxPixels = positiveLimit(limits.maxImagePixels, 4_000_000);
    const pixelDimension = Math.sqrt(maxPixels);
    return imageDimensions(width, height, Math.min(maxDimension, pixelDimension) * scale);
  }

  function encodeWithinBudget(canvas, mime, maxBytes, minQuality = .5) {
    const encode = (quality) => {
      const src = canvas.toDataURL(mime, quality);
      const payload = src.split(',')[1] || '';
      return { src, bytes: Math.ceil(payload.length * 3 / 4) };
    };
    let best = encode(.82);
    if (best.bytes <= maxBytes) return best;
    let low = minQuality;
    let high = .82;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const quality = (low + high) / 2;
      const result = encode(quality);
      if (result.bytes <= maxBytes) {
        best = result;
        low = quality;
      } else high = quality;
    }
    const floor = encode(minQuality);
    return floor.bytes < best.bytes ? floor : best;
  }

  function adaptiveEncode(canvas, image, mime, limits, sourceWidth, sourceHeight, alpha) {
    let last;
    for (const scale of [1, .9, .8, .72, .64, .56, .48]) {
      const dimensions = constrainedDimensions(sourceWidth, sourceHeight, limits, scale);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d', { alpha });
      if (!context) throw imageError('CANVAS_UNAVAILABLE', 'canvas unavailable');
      if (!alpha && typeof context.fillRect === 'function') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, dimensions.width, dimensions.height);
      }
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
      const encoded = encodeWithinBudget(canvas, mime, limits.maxImageBytes);
      last = { ...encoded, ...dimensions };
      if (encoded.bytes > 0 && encoded.bytes <= limits.maxImageBytes) return last;
    }
    throw imageError('ENCODE_TOO_LARGE', 'encoded image is too large', {
      bytes: last?.bytes, maxBytes: limits.maxImageBytes,
    });
  }

  function defaultFileReader() { return new globalThis.FileReader(); }
  function defaultImage() { return new globalThis.Image(); }
  function defaultCanvas() { return globalThis.document.createElement('canvas'); }

  function createImages({ getLimits, FileReader, Image, createCanvas = defaultCanvas }) {
    async function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = FileReader ? new FileReader() : defaultFileReader();
        reader.addEventListener('load', () => resolve(String(reader.result)));
        reader.addEventListener('error', () => reject(new Error('read failed')));
        reader.readAsDataURL(file);
      });
    }

    async function loadImage(source) {
      return new Promise((resolve, reject) => {
        const image = Image ? new Image() : defaultImage();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', () => reject(new Error('decode failed')));
        image.src = source;
      });
    }

    async function prepareImage(file) {
      const source = await fileToDataUrl(file);
      const image = await loadImage(source);
      const limits = getLimits();
      validateSource(image.naturalWidth, image.naturalHeight, MAX_SOURCE_PIXELS);
      // GIFs bypass canvas so that their animation survives preparation.
      if (file.type === 'image/gif') {
        validateGif(file, image.naturalWidth, image.naturalHeight, limits);
        return { src: source, width: image.naturalWidth, height: image.naturalHeight, bytes: file.size };
      }
      const canvas = createCanvas();
      const preserveAlpha = file.type === 'image/png';
      const mime = preserveAlpha && file.size <= limits.maxImageBytes ? 'image/png' : 'image/jpeg';
      const encoded = adaptiveEncode(canvas, image, mime, limits, image.naturalWidth, image.naturalHeight, preserveAlpha);
      return encoded;
    }

    return { prepareImage };
  }

  return { createImages, positiveLimit, imageDimensions, validateSource, validateGif, encodeWithinBudget, imageError, MAX_SOURCE_PIXELS };
});
