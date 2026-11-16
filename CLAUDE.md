# LAN Flow Card

A Home Assistant dashboard card (custom element, plain JavaScript, no build step, no dependencies): the network as
a tree or radial view, live traffic as moving dots on every cable, Wi-Fi clients found automatically, a history
panel per node, and a visual editor. Meant for HACS; MIT licensed.

## layout

| path | what |
|---|---|
| `lan-flow-card.js` | the whole card: layout (tree, client lists, radial), live update, history panel, visual editor |
| `hacs.json`, `README.md`, `LICENSE` | HACS manifest, user docs, MIT |
| `examples/` | YAML configs with made-up entity names, and the AmpliFi per-device sensor automation |
| `demo/index.html` | the card outside HA with made-up devices, traffic and history (`?cfg=network|wifi|radial|network-radial`, `w=`, `panel=`, `t=`, `light=1`) |
| `demo/make-gifs.sh` | rebuilds `docs/*.gif` from the demo (headless Chromium, ImageMagick, ffmpeg) |
| `dev/` | loader and docs for running a development copy next to the release in the same HA |
| `tests/` | browser tests: `editor-test.html` (12 checks), `panel-keep-test.html` (5 checks), `panel-test.html` (look at a screenshot) |

## how the code works (the parts that are easy to break)

- The element name comes from the module URL: `?name=lan-flow-card-dev` registers `lan-flow-card-dev` (and
  `...-editor`), so release and dev copy run side by side. Keep `customElements.get(NAME)` guards.
- `clients:` nodes get their children from `device_tracker` states with `SignalQuality` and an IP prefix (the AmpliFi
  integration's attributes: `RxBytes_15sec`/`TxBytes_15sec` = bytes of the last 15 s, missing when 0, Rx towards
  the device). A change in that set rebuilds the card; an open history panel must survive the rebuild.
- The history panel reads the per-device sensors of `examples/amplifi-client-sensors-automation.yaml` (MQTT device
  identifier `amplifi_client_<tracker without amplifi_>`, entity suffixes `_down`, `_up`, `_signal`, possibly
  `_2`), 1-24 h from `history/history_during_period`, 7-30 d from `recorder/statistics_during_period` (hourly).
- Values are converted to Mbit/s from each sensor's unit (`UNIT_TO_MBIT`); client sensors are kbit/s.
- The visual editor uses HA's lazy-loaded `ha-form` (loaded via `loadCardHelpers` and the entities card editor);
  it must keep unknown config keys and drop empty fields.
- Files stay ASCII (arrows as `↓`/`↑` escapes).

## testing

Serve the repo (`python3 -m http.server 8765 --bind 127.0.0.1`) and open the demo or tests in Chromium; headless:
`chromium --headless=new --virtual-time-budget=6000 --dump-dom http://127.0.0.1:8765/tests/editor-test.html` and read
the `<pre>` block (count PASS/FAIL only there: the page's own script contains the word FAIL). Syntax check as a
module: copy to a `.mjs` file and `node --check` it (plain `node --check` on the `.js` fails on `import.meta`).
Rebuild the GIFs after visible changes: `bash demo/make-gifs.sh`. Real HA testing happens on the owner's dev copy
(see `CLAUDE.local.md` if present).

## rules

- **Commits are anonymous:** this repo's git config must be `user.name naqoyqatsi83`,
  `user.email 47415995+naqoyqatsi83@users.noreply.github.com`. Check `git config user.email` before every commit;
  never commit with another address. End commit messages with the `Co-Authored-By` line for Claude.
- **No personal data in the repo:** no real IPs, SSIDs, hostnames, MAC addresses, entity names or anything else from
  the owner's home. Examples and the demo use made-up names (`192.168.1.x`, `192.168.20.x`, "Laptop", "Kitchen plug").
- The repo is private for now; making it public and submitting it to the HACS default list is the owner's decision.
- Text: plain ASCII, short sentences.

## roadmap

- Client discovery for other routers (UniFi, Fritz!Box, OpenWrt, TP-Link Omada) and a generic attribute mapping;
  testers: the owner's colleagues.
- First release tag, then going public and HACS.
