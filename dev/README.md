# testing a development copy

Run your changes next to the released card in the same Home Assistant, on your real data, without touching the
dashboards that use the release.

| | type in YAML | file |
|---|---|---|
| release | `custom:lan-flow-card` | installed by HACS (or `/config/www/lan-flow-card.js`) |
| development | `custom:lan-flow-card-dev` | `/config/www/dev/lan-flow-card-dev.js` |

The card takes its element name from its URL (`lan-flow-card.js?name=lan-flow-card-dev`), so both copies can be
loaded at the same time.

## set up once

1. Create `/config/www/dev/` and copy `lan-flow-card.js` there as `lan-flow-card-dev.js`, plus
   `dev/lan-flow-card-dev-loader.js`.
2. Settings > Dashboards > three-dot menu > Resources: add `/local/dev/lan-flow-card-dev-loader.js?v=1`, type
   *JavaScript module*. Copy the files first: a browser that asked for the loader before it existed may keep the
   "404 not found" in its cache; then change `?v=` to get a fresh copy.
3. Make a test dashboard (or view) with your card configs, with `type: custom:lan-flow-card-dev`.

## after each change

Copy the new `lan-flow-card.js` to `/config/www/dev/lan-flow-card-dev.js` and reload the page. The loader adds a
timestamp to the URL, so the browser always fetches the newest copy; there is no `?v=` to raise. (The loader
itself is cached like any resource, but it never changes.)
