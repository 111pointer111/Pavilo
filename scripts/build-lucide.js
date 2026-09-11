'use strict';

// Generates vendor/lucide/index.js from the vendored icon-nodes.json.
// The result is a UMD module exposing `window.lucideCreateIcon(name, options)`.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VERSION = require(path.join(ROOT, 'vendor/lucide/package.json')).version;

const nodes = JSON.parse(fs.readFileSync(path.join(ROOT, 'vendor/lucide/icon-nodes.json'), 'utf8'));

// lucide-static stores each icon as an array of `[tag, attributes]` tuples.
const compact = {};
for (const [name, shapes] of Object.entries(nodes)) {
  if (!Array.isArray(shapes) || !shapes.length) continue;
  compact[name] = shapes;
}

const body = `/**
 * Lucide ${VERSION} icon data and a tiny SVG builder.
 *
 * Generated from lucide-static@${VERSION} (ISC) \`icon-nodes.json\`.
 * Pavilo vendors the icon set so the chat stays fully self-hosted and offline.
 * Regenerate with: node scripts/build-lucide.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.lucideCreateIcon = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ICONS = ${JSON.stringify(compact)};

  var ATTRS = {
    path: ['d'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    polyline: ['points'],
    polygon: ['points']
  };

  function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function shapeMarkup(shape) {
    var tag = shape[0];
    var attributes = ATTRS[tag];
    if (!attributes) return '';
    var source = shape[1] || {};
    var out = '<' + tag;
    for (var index = 0; index < attributes.length; index += 1) {
      var key = attributes[index];
      if (source[key] === undefined) continue;
      out += ' ' + key + '="' + escapeAttribute(source[key]) + '"';
    }
    return out + '/>';
  }

  /**
   * Builds the inner markup of a Lucide icon.
   * @param {string} name kebab-case icon name, e.g. "image-plus"
   * @returns {string} SVG children, or an empty string when the name is unknown
   */
  function lucideIcon(name) {
    var shapes = ICONS[name];
    if (!shapes) return '';
    var markup = '';
    for (var index = 0; index < shapes.length; index += 1) markup += shapeMarkup(shapes[index]);
    return markup;
  }

  lucideIcon.version = '${VERSION}';
  lucideIcon.names = Object.keys(ICONS);
  return lucideIcon;
}));
`;

fs.writeFileSync(path.join(ROOT, 'vendor/lucide/index.js'), body);
process.stdout.write(`vendor/lucide/index.js written: ${Object.keys(compact).length} icons, ${body.length} bytes\n`);
