# vendor/emoji-picker

Vendored copy of the [emoji-picker-element](https://www.npmjs.com/package/emoji-picker-element)
web component plus its emoji dataset, so the chat stays fully self-hosted and
works offline — no runtime CDN requests (the default data source points at
jsdelivr, which the app's CSP rejects).

| File | Source | Purpose |
| --- | --- | --- |
| `index.js` | emoji-picker-element 1.29.1 | entry, re-exports picker + database |
| `picker.js` | emoji-picker-element 1.29.1 | the `<emoji-picker>` custom element (registers itself) |
| `database.js` | emoji-picker-element 1.29.1 | IndexedDB-backed emoji store / search |
| `i18n/zh_CN.js` | emoji-picker-element 1.29.1 | official Simplified Chinese UI labels |
| `data.json` | emoji-picker-element-data 1.8.0 `zh/emojibase-native/data.json` | full Unicode emoji dataset with Chinese search keywords (1923 emoji) |
| `LICENSE` | Apache-2.0 | both npm package versions above declare Apache-2.0; the vendored license text matches |

## Usage

`<emoji-picker>` reads the dataset from our own HTTP server:

```html
<emoji-picker locale="zh" data-source="/vendor/emoji-picker/data.json"></emoji-picker>
```

`locale="zh"` names the IndexedDB store `emoji-picker-element-zh`; the UI text
is injected via the `i18n` property (see `index.html`).

## Updating

```sh
npm pack emoji-picker-element emoji-picker-element-data   # latest versions
# copy: index.js picker.js database.js i18n/zh_CN.js LICENSE
# copy: package/zh/emojibase-native/data.json -> data.json
```

Then bump the versions in the table above and re-run the test suite.