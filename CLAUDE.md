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
| `tests/` | `run.sh` (all automated checks), browser tests: `editor-test.html` (12 checks), `panel-keep-test.html` (5 checks), `panel-test.html` (look at a screenshot) |
| `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` | release notes, rules for contributors, private vulnerability reports |
| `.github/` | CI workflow (runs `tests/run.sh`), issue templates (bug, idea), pull request template |

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
- Files stay ASCII (arrows written as the JavaScript escapes `\u2193` and `\u2191`).

## testing

`bash tests/run.sh` runs everything automated: syntax check, ASCII check, and both browser tests in headless
Chromium (set `CHROME=` to the browser, e.g. `"/c/Program Files/Google/Chrome/Application/chrome.exe"` on Windows).
It exits 1 on any failure. CI (`.github/workflows/ci.yml`) runs it on every push and pull request to `dev`/`main`;
keep it passing. Add a check to a test page for a bug it could have caught.

By hand: serve the repo (`python3 -m http.server 8765 --bind 127.0.0.1`) and open the demo or tests in Chromium; headless:
`chromium --headless=new --virtual-time-budget=6000 --dump-dom http://127.0.0.1:8765/tests/editor-test.html` and read
the `<pre>` block (count PASS/FAIL only there: the page's own script contains the word FAIL). Syntax check as a
module: copy to a `.mjs` file and `node --check` it (plain `node --check` on the `.js` fails on `import.meta`).
Rebuild the GIFs after visible changes: `bash demo/make-gifs.sh`. Real HA testing happens on the owner's dev copy
(see `CLAUDE.local.md` if present).

## branches and merging

- `dev` is the working branch: commit there (or in a branch off it, merged back into `dev`). Pull requests go to
  `dev`.
- `main` only holds releases. It changes only by merging `dev` with `--no-ff` at a final release
  (`Merge branch 'dev' into main for v<version>`); never commit to `main` directly.
- Before merging into `main`: `tests/run.sh` passes, CI is green on `dev`, GIFs are current.

## bugs and issues

- **Every bug found gets a GitHub issue first**, whoever finds it (the owner, a tester, a review, you while working
  on something else): `gh issue create --label bug`, body with `### What happened`, `### Expected`, and
  `### Card version` (the last release tag, or `dev` at its commit). Ideas get the `enhancement` label.
- Then fix it on `dev` with one `fix:` commit per issue whose body ends with `Closes #N`. The issue closes when
  that commit reaches `main` at the release, so open issues on GitHub are exactly what the last release still has.
- Found several things at once (e.g. in a review)? One issue per independent bug; group small related ones into
  one issue with a list.
- Issues are as public as the repo: no personal data in them either (see rules).

## commit messages

- Conventional prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`
- Lowercase after the prefix, no period at the end, subject under 70 characters
- The body says what changed and why; it ends with `Closes #N` when there is an issue

## changelog

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

- `## [Unreleased]` at the top for pending changes; each release under `## [<version>] - <YYYY-MM-DD>`
- Subheadings `### Added`, `### Changed`, `### Fixed`, `### Removed`
- Imperative mood ("Add", "Fix"), one bullet per logical change, written for a user, issue number at the end
  (`(#12)`); anything a user would notice gets a line in the same commit as the change

## versioning and releases

- Tags `v<major>.<minor>.<patch>`; release candidates `v<version>-rc<N>` (stay on `dev`, published as GitHub
  pre-releases).
- Pick the number yourself from `[Unreleased]` (SemVer read as PrideVer, `PROUD.DEFAULT.SHAME`): any `Added`,
  `Changed` or `Removed` entry bumps minor and resets patch; only `Fixed` entries bump patch. Major is the owner's:
  stay on `0.x.y`. The first release is `v0.1.0`.
- Release steps:
  1. Move `[Unreleased]` under a new dated `## [<version>]` heading. For a final release, fold its release
     candidates' sections into one, written for someone coming from the previous final.
  2. Commit `chore: release v<version>` on `dev`, tag `v<version>`, push `dev` and the tag.
  3. Final releases only: merge `dev` into `main` with `--no-ff`, push `main` (this closes the `Closes #N` issues).
  4. `gh release create v<version> --notes-file <that changelog section>` (`--prerelease` for an rc). HACS offers
     the GitHub releases as versions.

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
- First release tag (`v0.1.0`), then going public and HACS.
