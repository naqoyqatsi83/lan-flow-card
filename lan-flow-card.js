/*
 * lan-flow-card: your network as a tree (or radial view), each cable with moving dots for its live traffic.
 * Home Assistant custom card, no dependencies. https://github.com/naqoyqatsi83/lan-flow-card
 * Install through HACS, or copy this file to /config/www/ and add the dashboard resource
 * /local/lan-flow-card.js (JavaScript module). Configuration: see README.md.
 *
 * Every node except the root names its parent and the sensors of the cable to it:
 *   down: traffic from the parent to the node, up: from the node to the parent, link: "down" dims the node.
 * note: fixed text under the name; note_entity (+ note_attribute): live text from an entity instead.
 * Rates are converted to Mbit/s from the sensor's unit (bit/s, kbit/s, Mbit/s, B/s, kB/s, KiB/s, MB/s, ...).
 * Dots run along the cable in the direction of the traffic, thicker and faster the more it carries.
 *
 * clients: on a node, its children come from the AmpliFi integration's trackers instead of the config: every
 *   tracker that is home, has SignalQuality (a Wi-Fi client) and an IP (Address) starting with clients.prefix.
 *   Down / up from RxBytes_15sec / TxBytes_15sec (bytes of the last 15 s, missing when 0; Rx is towards the
 *   device), beside it the signal quality. New devices show up by themselves; sorted by name. The node gets one
 *   column, its devices hang below it off a trunk, one per line. Optional: clients.icon, clients.exclude.
 *   A tap on a client opens a panel with its traffic and signal history: from the sensors of the automation
 *   "AmpliFi client sensors" (examples/; MQTT device identifier amplifi_client_<tracker without "amplifi_">).
 * layout: radial (on the card): instead of the tree, the root in the middle and all clients around it, a colored
 *   sector per node with `clients`; the stronger the signal, the closer. Names in two columns. Below 560 px wide
 *   (a phone upright) the card shows the tree. Taps open the same history panel.
 * down / up on the card (not a node): the rates in the header; otherwise those of the root's first child.
 * idle_mbit: below this a cable is drawn without dots (default 0.05).
 */
const UNIT_TO_MBIT = {
  "bit/s": 1e-6, "kbit/s": 1e-3, "Mbit/s": 1, "Gbit/s": 1e3,
  "B/s": 8e-6, "kB/s": 8e-3, "KB/s": 8e-3, "MB/s": 8, "GB/s": 8e3,
  "KiB/s": 8 * 1024 / 1e6, "MiB/s": 8 * 1048576 / 1e6, "GiB/s": 8 * 1073741824 / 1e6,
};
const IDLE = 0.05;      // Mbit/s; below this a lane is drawn idle, without dots (config: idle_mbit)
const DOT_GAP = 12;     // px between dots
const ROW = 130;        // px between tree levels
const ROW_COMPACT = 134;
const STAGGER = 96;     // px; compact mode puts every other leaf this much lower, so labels get two slots of width
const R = 24;           // node radius
const CLIENT_ROW = 40;   // px per client line under a node with `clients`
const CLIENT_R = 12;    // client node radius (compact: 10)
const DOWN = "\u2193";  // arrows as escapes, so the file stays ASCII
const UP = "\u2191";
const SVG = "http://www.w3.org/2000/svg";
// The element name comes from this file's URL (`?name=lan-flow-card-dev`), so a development copy can run next to
// the released card in the same Home Assistant. See dev/README.md.
const NAME = new URL(import.meta.url).searchParams.get("name") || "lan-flow-card";

function mbit(hass, entityId) {
  const st = entityId && hass.states[entityId];
  if (!st) return null;
  const v = parseFloat(st.state);
  if (!isFinite(v)) return null;
  const f = UNIT_TO_MBIT[st.attributes.unit_of_measurement];
  return f === undefined ? v : v * f;
}

// A rate in Mbit/s as text with its unit, scaled: "120 kbit/s", "7.8 Mbit/s", "1.2 Gbit/s" (short: "120 kb/s").
function rate(v, short) {
  if (v === null) return "-";
  let n = v, u = "M";
  if (v >= 1000) { n = v / 1000; u = "G"; }
  else if (v > 0 && v < 1) { n = v * 1000; u = "k"; }
  const t = n === 0 ? "0" : u === "k" || n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(n >= 1 ? 1 : 2);
  return short ? t + " " + u + "b/s" : t + " " + u + "bit/s";
}

function fmt(v) {
  if (v === null) return "-";
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(v >= 1 ? 1 : 2);
}

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  return e;
}

class LanFlowCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement(NAME + "-editor");
  }

  static getStubConfig() {
    return {
      title: "Network",
      nodes: [
        { id: "internet", name: "Internet", icon: "mdi:web", color: "#66bb6a" },
        { id: "router", parent: "internet", name: "Router", icon: "mdi:router-network", color: "#ffca28" },
      ],
    };
  }

  setConfig(config) {
    if (!config.nodes || !config.nodes.length) throw new Error("nodes: list them, the first one is the root");
    const ids = new Set(config.nodes.map((n) => n.id));
    for (const n of config.nodes.slice(1)) {
      if (!ids.has(n.parent)) throw new Error("node " + n.id + ": parent '" + n.parent + "' is not a node");
    }
    this._config = config;
    this._nodes = config.nodes;
    this._clientKey = "";
    this._built = false;
    this._width = 0;
    if (this._hass) this._clients();  // the editor calls setConfig again with every change
    if (this.isConnected) this._build();
  }

  connectedCallback() {
    this.style.display = "block";  // so clientWidth is the card's width before the first build
    if (!this._resize) {
      this._resize = new ResizeObserver(() => {
        const w = this.clientWidth;
        if (w && Math.abs(w - this._width) > 2) { this._width = w; this._build(); }
      });
    }
    this._resize.observe(this);
  }

  disconnectedCallback() {
    if (this._resize) this._resize.disconnect();
    clearInterval(this._panelTimer);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;  // HA may set hass before the config
    this._clients();
    if (!this._built) this._build();
    this._update();
  }

  // Nodes generated from the AmpliFi trackers, under every node with `clients`; rebuild when the set changes.
  _clients() {
    const base = this._config.nodes;
    if (!base.some((n) => n.clients)) return;
    const gen = [];
    const states = this._hass.states;
    for (const parent of base.filter((n) => n.clients)) {
      const c = parent.clients;
      const exclude = new Set(c.exclude || []);
      const mine = [];
      for (const [id, st] of Object.entries(states)) {
        if (!id.startsWith("device_tracker.") || st.state !== "home" || exclude.has(id)) continue;
        const a = st.attributes;
        if (a.SignalQuality === undefined || a.SignalQuality === null) continue;
        if (!String(a.Address || a.ip || "").startsWith(c.prefix || "")) continue;
        mine.push({
          id: id, parent: parent.id, name: a.friendly_name || id.slice(15), entity: id, _client: id,
          icon: c.icon || "mdi:wifi", color: parent.color, note: " ",
        });
      }
      mine.sort((x, y) => x.name.localeCompare(y.name));
      gen.push(...mine);
    }
    const key = gen.map((n) => n.parent + ">" + n.id + ">" + n.name).join(",");
    if (key === this._clientKey) return;
    this._clientKey = key;
    this._nodes = base.concat(gen);
    this._built = false;
  }

  // A cable's rate in Mbit/s: from the node's sensor, or for a client from its tracker.
  _rate(n, dir) {
    if (!n._client) return mbit(this._hass, n[dir]);
    const st = this._hass.states[n._client];
    if (!st) return null;
    const v = parseFloat(st.attributes[dir === "down" ? "RxBytes_15sec" : "TxBytes_15sec"]);
    return (isFinite(v) ? v : 0) * 8 / 15 / 1e6;
  }

  getCardSize() {
    return 2 + 3 * this._depth();
  }

  getGridOptions() {
    return { columns: "full", min_columns: 6, rows: "auto" };
  }

  _depth() {
    if (!this._config) return 1;
    const byId = Object.fromEntries(this._nodes.map((n) => [n.id, n]));
    let max = 0;
    for (const n of this._nodes) {
      let d = 0, p = n;
      while (p.parent) { p = byId[p.parent]; d++; }
      max = Math.max(max, d);
    }
    return max;
  }

  _leaves() {
    const nodes = this._nodes;
    const parents = new Set(nodes.map((n) => n.parent));
    return nodes.filter((n) => !parents.has(n.id)).length;
  }

  _layout(width) {
    const nodes = this._nodes;
    const r = this._r;
    const kids = {};
    for (const n of nodes) if (n.parent) (kids[n.parent] = kids[n.parent] || []).push(n.id);
    // A node with clients takes one column; its clients hang below it, one per line.
    const list = {};
    for (const n of nodes) if (n.clients && kids[n.id]) list[n.id] = true;
    const leaves = (id) => (list[id] ? 1 : kids[id] ? kids[id].reduce((s, k) => s + leaves(k), 0) : 1);
    const pos = {};
    let leaf = 0;
    const total = leaves(nodes[0].id);
    const colW = width / total;
    const place = (id, depth) => {
      const y0 = r + 30 + depth * (this._compact ? ROW_COMPACT : ROW);
      if (list[id]) {
        const left = leaf * colW;
        pos[id] = { x: left + colW / 2, y: y0 };
        // the trunk: at the column's left edge, but on a wide card just left of the node, so the list sits under it
        const xt = Math.max(left + (this._compact ? 10 : 18), left + colW / 2 - 110);
        const ys = y0 + r + (this._compact ? 58 : 40);            // below the node's name and rates
        kids[id].forEach((k, i) => {
          pos[k] = { x: xt + (this._compact ? 22 : 28), y: ys + CLIENT_ROW / 2 + i * CLIENT_ROW, client: true,
                     xt, ys, right: left + colW };
        });
        leaf++;
        return;
      }
      if (kids[id]) {
        kids[id].forEach((k) => place(k, depth + 1));
        const xs = kids[id].map((k) => pos[k].x);
        pos[id] = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: 0 };
      } else {
        pos[id] = { x: ((leaf + 0.5) / total) * width, y: 0, leaf: true };
        if (this._compact && leaf % 2) pos[id].y = STAGGER;
        leaf++;
      }
      pos[id].y += y0;
    };
    place(nodes[0].id, 0);
    return pos;
  }

  _build() {
    if (!this._config) return;
    const width = this.clientWidth || this._width || 600;
    this._width = width;
    // Narrow card (phone): smaller circles, names wrap, rates under the name instead of beside the node.
    const slot = width / this._leaves();
    // With client lists, only the card's width decides.
    this._compact = this._nodes.some((n) => n.clients) ? width < 560 : slot < 120;
    const r = (this._r = this._compact ? 17 : R);
    const compact = this._compact;
    const cr = compact ? CLIENT_R - 2 : CLIENT_R;
    const radial = this._config.layout === "radial" && !compact && this._nodes.some((n) => n._client);
    // radial asked for but not possible: say why in the header instead of silently drawing the tree
    const radialWhy = this._config.layout !== "radial" || radial ? ""
      : !this._config.nodes.some((n) => n.clients) ? "radial view needs a node that finds its clients"
      : compact ? "radial view needs a wider card" : "radial view: no clients found yet";
    const pos = radial ? null : this._layout(width);
    const geo = radial ? this._radialLayout(width) : null;
    const height = radial ? geo.height : Math.max(...Object.values(pos).map((p) => p.y)) + r + (compact ? 58 : 64);

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    const keep = this._panel && this._panel.isConnected ? this._panel : null;
    if (keep) keep.remove();
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = `
      :host { display: block; }
      ha-card { padding: 12px 0 4px; overflow: hidden; position: relative; }
      .panel { position: absolute; left: 8px; right: 8px; z-index: 5; max-width: 560px; margin: 0 auto;
               background: var(--card-background-color, #1c1c1c); border: 1px solid var(--divider-color, #444);
               border-radius: 12px; padding: 10px 12px 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, .45);
               font-size: 12px; color: var(--secondary-text-color); }
      .panel .top { display: flex; align-items: baseline; gap: 8px; }
      .panel .top b { font-size: 15px; font-weight: 500; color: var(--primary-text-color); flex: 1;
                      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .panel button { background: none; border: 1px solid var(--divider-color, #444); border-radius: 12px;
                      color: var(--primary-text-color); font: inherit; padding: 2px 9px; cursor: pointer; }
      .panel button.on { border-color: var(--primary-color); color: var(--primary-color); }
      .panel .x { border: none; font-size: 18px; line-height: 1; padding: 0 2px; }
      .panel .facts { margin: 2px 0 6px; }
      .panel .ranges { display: flex; gap: 6px; margin: 4px 0; flex-wrap: wrap; }
      .panel .ranges .more { margin-left: auto; }
      .panel svg { position: static; display: block; overflow: visible; }
      .panel .axis { font: 10px sans-serif; fill: var(--secondary-text-color); }
      .panel .grid { stroke: var(--divider-color, #444); stroke-width: 1; }
      .panel .msg { padding: 24px 0; text-align: center; }
      .panel .chart { min-height: 230px; position: relative; }
      .panel .top { cursor: move; touch-action: none; user-select: none; }
      .panel .fields { display: none; max-height: 160px; overflow: auto; margin: 4px 0; font-size: 11px;
                       border: 1px solid var(--divider-color, #444); border-radius: 6px; padding: 4px 8px; }
      .panel .fields.open { display: grid; grid-template-columns: max-content 1fr; gap: 1px 12px; }
      .panel .fields span:nth-child(odd) { color: var(--primary-text-color); }
      .panel .fields span:nth-child(even) { overflow-wrap: anywhere; }
      .panel .hover { position: absolute; top: 0; pointer-events: none; display: none; white-space: nowrap;
                      background: var(--card-background-color, #1c1c1c); border: 1px solid var(--divider-color, #444);
                      border-radius: 6px; padding: 3px 7px; font-size: 11px; line-height: 15px; z-index: 2;
                      color: var(--primary-text-color); box-shadow: 0 2px 8px rgba(0, 0, 0, .35); }
      .panel .hover .d { color: var(--nfc-down, #29b6f6); }
      .panel .hover .u { color: var(--nfc-up, #ffa726); }
      .panel .cursor { stroke: var(--secondary-text-color); stroke-width: 1; stroke-dasharray: 2 2; display: none; }
      .ring { fill: none; stroke: var(--divider-color, #444); stroke-dasharray: 2 4; }
      .ringlabel { font: 10px sans-serif; fill: var(--secondary-text-color); text-anchor: middle; }
      .sector { fill: none; stroke-width: 4; stroke-linecap: round; opacity: .7; }
      .spoke { stroke: var(--divider-color, #444); stroke-width: 1; }
      .leader { fill: none; stroke: var(--divider-color, #444); stroke-width: 1; opacity: .6; }
      .dev { cursor: pointer; transition: opacity .6s; }
      .dev circle { stroke: var(--card-background-color, #1c1c1c); stroke-width: 2; }
      .dev.idle { opacity: .4; }
      .dev.busy circle { filter: drop-shadow(0 0 4px var(--nfc-node)); }
      .clabel.l { text-align: right; }
      .legend { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; }
      .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 5px 0 0;
                  background: var(--nfc-node); }
      .head { display: flex; gap: 18px; align-items: baseline; padding: 0 16px; flex-wrap: wrap; }
      .title { font-size: 1.2em; font-weight: 500; }
      .stat { color: var(--secondary-text-color); font-size: 0.95em; white-space: nowrap; }
      .stat b { color: var(--primary-text-color); font-weight: 500; }
      .area { position: relative; width: 100%; }
      svg { position: absolute; left: 0; top: 0; overflow: visible; }
      .base { fill: none; stroke: var(--divider-color, #444); stroke-width: 2; }
      .lane { fill: none; stroke-linecap: round; opacity: 0; transition: opacity .6s, stroke-width .6s; }
      .lane.on { opacity: 1; animation: flow linear infinite; }
      .lane.down { stroke: var(--nfc-down, #29b6f6); }
      .lane.up { stroke: var(--nfc-up, #ffa726); animation-direction: reverse; }
      @keyframes flow { from { stroke-dashoffset: ${DOT_GAP}; } to { stroke-dashoffset: 0; } }
      .rate { font: 11px var(--paper-font-body1_-_font-family, sans-serif); fill: var(--secondary-text-color);
              text-anchor: start; }
      .rate .d { fill: var(--nfc-down, #29b6f6); }
      .rate .u { fill: var(--nfc-up, #ffa726); }
      .node { position: absolute; width: ${2 * r}px; height: ${2 * r}px; margin: -${r}px 0 0 -${r}px;
              border-radius: 50%; border: 2px solid var(--nfc-node, var(--primary-color));
              background: var(--card-background-color, #1c1c1c); display: flex; align-items: center;
              justify-content: center; box-sizing: border-box; transition: opacity .6s, box-shadow .6s; }
      .node ha-icon { --mdc-icon-size: ${compact ? 18 : 24}px; color: var(--nfc-node, var(--primary-color)); }
      .node.busy { box-shadow: 0 0 12px 1px var(--nfc-node, var(--primary-color)); }
      .node.off { opacity: .35; border-style: dashed; }
      .node.idle, .name.idle { opacity: .45; }
      .name { position: absolute; transform: translateX(-50%); margin-top: ${r + 4}px;
              font-size: ${compact ? 10 : 12}px; color: var(--primary-text-color); text-align: center;
              line-height: 1.25; ${compact ? "" : "white-space: nowrap;"} }
      .node.client { width: ${2 * cr}px; height: ${2 * cr}px; margin: -${cr}px 0 0 -${cr}px; border-width: 1.5px; }
      .node.client ha-icon { --mdc-icon-size: ${compact ? 12 : 14}px; }
      .clabel { position: absolute; font-size: ${compact ? 11 : 12}px; line-height: 15px; white-space: nowrap;
                overflow: hidden; text-overflow: ellipsis; color: var(--primary-text-color); cursor: pointer;
                transition: opacity .6s; }
      .clabel div { overflow: hidden; text-overflow: ellipsis; }
      .clabel .r { font-size: ${compact ? 10 : 11}px; color: var(--secondary-text-color); }
      .clabel .d { color: var(--nfc-down, #29b6f6); }
      .clabel .u { color: var(--nfc-up, #ffa726); }
      .clabel.idle { opacity: .45; }
      .clabel .d.none { color: inherit; }
      .name small { color: var(--secondary-text-color); display: block; white-space: normal;
                    width: ${Math.max(60, Math.floor(slot) - 8)}px; margin: 0 auto; }
    `;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span class="title"></span><span class="stat" id="inet"></span><span class="stat" id="lat"></span>`;
    if (radialWhy) {
      const why = document.createElement("span");
      why.className = "stat";
      why.textContent = "(" + radialWhy + ")";
      head.appendChild(why);
    }
    head.querySelector(".title").textContent = this._config.title || "";
    card.appendChild(head);

    const area = document.createElement("div");
    area.className = "area";
    area.style.height = height + "px";
    const svg = svgEl("svg", { width: width, height: height, viewBox: `0 0 ${width} ${height}` });
    area.appendChild(svg);

    this._els = {};
    if (radial) this._radialDraw(geo, area, svg, head);
    else for (const n of this._nodes) {
      const p = pos[n.id];
      const els = { node: n };
      if (p.client) {
        this._client(n, p, pos[n.parent], area, svg, els, cr);
        this._els[n.id] = els;
        continue;
      }
      if (n.parent) {
        const q = pos[n.parent];
        const parent = this._nodes.find((m) => m.id === n.parent);
        // below the parent's name (and its rates, in compact mode)
        const y0 = q.y + r + (compact ? (parent.parent ? 58 : 30) : parent.note || parent.note_entity ? 34 : 20);
        const mid = (y0 + p.y - r) / 2;
        const path = (o) => `M ${q.x + o} ${y0} C ${q.x + o} ${mid}, ${p.x + o} ${mid}, ${p.x + o} ${p.y - r}`;
        svg.appendChild(svgEl("path", { d: path(0), class: "base" }));
        els.down = svgEl("path", { d: path(-3), class: "lane down" });
        els.up = svgEl("path", { d: path(3), class: "lane up" });
        svg.appendChild(els.down);
        svg.appendChild(els.up);
        // Beside the node, or on its left near the right edge; under the name in compact mode.
        const left = !compact && p.x + r + 80 > width;
        const rx = compact ? Math.min(Math.max(p.x, 36), width - 36) : left ? p.x - r - 6 : p.x + r + 6;
        els.rate = svgEl("text", { x: rx, y: compact ? p.y + r + 40 : p.y - 4, class: "rate" });
        if (compact) els.rate.setAttribute("style", "text-anchor: middle; font-size: 10px");
        else if (left) els.rate.setAttribute("style", "text-anchor: end");
        const d = svgEl("tspan", { class: "d", x: rx });
        const u = svgEl("tspan", { class: "u", x: rx, dy: compact ? 11 : 14 });
        els.rate.appendChild(d);
        els.rate.appendChild(u);
        els.rateD = d;
        els.rateU = u;
        svg.appendChild(els.rate);
      }
      const circle = document.createElement("div");
      circle.className = "node";
      circle.style.left = p.x + "px";
      circle.style.top = p.y + "px";
      if (n.color) circle.style.setProperty("--nfc-node", n.color);
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", n.icon || "mdi:lan");
      circle.appendChild(icon);
      if (n.down || n.up) {
        // the history panel of this node's cable; its `details` button opens n.entity
        circle.style.cursor = "pointer";
        circle.addEventListener("click", () => this._openPanel(n, p));
      } else if (n.entity) {
        circle.style.cursor = "pointer";
        circle.addEventListener("click", () => this._more(n.entity));
      }
      area.appendChild(circle);
      const name = document.createElement("div");
      name.className = "name";
      name.style.left = p.x + "px";
      name.style.top = p.y + "px";
      if (compact) {
        // two slots wide (leaves are staggered), at most 96 px for the others, and inside the card
        const w = Math.min(p.leaf ? Infinity : 96, Math.floor(2 * slot) - 6, 2 * (p.x - 2), 2 * (width - p.x - 2));
        name.style.width = Math.max(w, 2 * r) + "px";
      }
      name.textContent = n.name || n.id;
      if ((n.note || n.note_entity) && !compact) {
        const small = document.createElement("small");
        small.textContent = n.note || "";
        name.appendChild(small);
        els.note = small;
      }
      area.appendChild(name);
      els.circle = circle;
      els.name = name;
      this._els[n.id] = els;
    }
    card.appendChild(area);
    root.appendChild(card);
    // An open history panel survives the rebuild (devices come and go): moved into the new card, same place,
    // same range, its reload timer keeps running. Closed only if its node is gone.
    if (keep && this._nodes.some((n) => n.id === this._panelFor)) {
      card.appendChild(keep);
      this._panel = keep;
    } else {
      this._panel = null;
      this._panelFor = null;
      clearInterval(this._panelTimer);
    }
    this._built = true;
    this._last = {};
    if (this._hass) this._update();
  }

  // A client line: cable from the parent down the trunk and right to the node, name and rates beside it.
  _client(n, p, q, area, svg, els, cr) {
    const r = this._r;
    const y0 = q.y + r + (this._compact ? 58 : 34);
    const path = `M ${q.x} ${y0} C ${q.x} ${p.ys}, ${p.xt} ${y0}, ${p.xt} ${p.ys} L ${p.xt} ${p.y - 8} ` +
      `Q ${p.xt} ${p.y}, ${p.xt + 8} ${p.y} L ${p.x - cr} ${p.y}`;
    svg.appendChild(svgEl("path", { d: path, class: "base", style: "stroke-width: 1.5" }));
    els.down = svgEl("path", { d: path, class: "lane down", transform: "translate(-2.5 -2.5)" });
    els.up = svgEl("path", { d: path, class: "lane up", transform: "translate(2.5 2.5)" });
    svg.appendChild(els.down);
    svg.appendChild(els.up);
    const open = () => this._openPanel(n, p);
    const circle = document.createElement("div");
    circle.className = "node client";
    circle.style.left = p.x + "px";
    circle.style.top = p.y + "px";
    circle.style.cursor = "pointer";
    if (n.color) circle.style.setProperty("--nfc-node", n.color);
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", n.icon || "mdi:wifi");
    circle.appendChild(icon);
    circle.addEventListener("click", open);
    area.appendChild(circle);
    const label = document.createElement("div");
    label.className = "clabel";
    label.style.left = p.x + cr + 6 + "px";
    label.style.top = p.y - 15 + "px";
    label.style.width = Math.max(40, p.right - p.x - cr - 10) + "px";
    label.innerHTML = `<div></div><div class="r"><span class="d"></span> <span class="u"></span> <span></span></div>`;
    label.firstChild.textContent = n.name;
    label.title = n.name;
    label.addEventListener("click", open);
    area.appendChild(label);
    const spans = label.querySelectorAll(".r span");
    els.rateD = spans[0];
    els.rateU = spans[1];
    els.note = spans[2];
    els.circle = circle;
    els.name = label;
  }

  // Radial layout: angles per client (one slot each, an empty one between groups), radius from the signal, and
  // label rows in two columns spread so they don't overlap.
  _radialLayout(width) {
    const ROWH = 32, NODE_R = 7;
    const devs = this._nodes.filter((n) => n._client).map((n) => {
      const st = this._hass.states[n._client];
      const q = st ? parseFloat(st.attributes.SignalQuality) : NaN;
      return { n, q: isFinite(q) ? q : 50, group: this._nodes.find((m) => m.id === n.parent) };
    });
    const colW = Math.min(200, Math.floor(width * 0.26));
    const rMax = Math.max(90, Math.min(230, width / 2 - colW - 34));
    const rMin = Math.max(R + 26, rMax * 0.3);
    const groups = [];
    for (const d of devs) if (groups[groups.length - 1] !== d.group) groups.push(d.group);
    const slots = devs.length + (groups.length > 1 ? groups.length : 0);
    let slot = 0, prev = null;
    for (const d of devs) {
      if (prev !== d.group && groups.length > 1) slot += prev ? 1 : 0.5;
      prev = d.group;
      d.a = ((slot + 0.5) / slots) * 2 * Math.PI - Math.PI / 2;
      slot++;
    }
    const right = devs.filter((d) => Math.cos(d.a) >= -1e-9);
    const left = devs.filter((d) => Math.cos(d.a) < -1e-9);
    const height = Math.max(2 * rMax + 70, Math.max(right.length, left.length) * ROWH + 24);
    const cx = width / 2, cy = height / 2;
    for (const d of devs) {
      // signal 100 % on rMin, 50 % and less on rMax
      d.r = rMin + (rMax - rMin) * Math.min(1, Math.max(0, (100 - d.q) / 50));
      d.x = cx + d.r * Math.cos(d.a);
      d.y = cy + d.r * Math.sin(d.a);
      d.side = Math.cos(d.a) >= -1e-9 ? "r" : "l";
    }
    const spread = (list) => {
      list.sort((p, q) => p.y - q.y);
      let y = -Infinity;
      for (const d of list) { d.ly = Math.max(d.y - ROWH / 2, y + ROWH, 4); y = d.ly; }
      let bottom = height - ROWH - 4;
      for (let i = list.length - 1; i >= 0; i--) { list[i].ly = Math.min(list[i].ly, bottom); bottom = list[i].ly - ROWH; }
    };
    spread(right);
    spread(left);
    return { devs, groups, slots, height, cx, cy, rMin, rMax, colW, ROWH, NODE_R };
  }

  _radialDraw(geo, area, svg, head) {
    const { devs, groups, slots, cx, cy, rMin, rMax, colW, ROWH, NODE_R } = geo;
    // legend in the header: network, color, devices
    const legend = document.createElement("span");
    legend.className = "legend";
    for (const g of groups) {
      const s = document.createElement("span");
      s.style.setProperty("--nfc-node", g.color || "var(--primary-color)");
      s.style.marginRight = "12px";
      s.innerHTML = "<i></i>";
      s.appendChild(document.createTextNode((g.name || g.id) + " " + devs.filter((d) => d.group === g).length));
      legend.appendChild(s);
    }
    head.appendChild(legend);
    for (const q of [90, 70]) {
      const r = rMin + (rMax - rMin) * (100 - q) / 50;
      svg.appendChild(svgEl("circle", { cx, cy, r, class: "ring" }));
      const t = svgEl("text", { x: cx, y: cy - r - 3, class: "ringlabel" });
      t.textContent = "signal " + q + "%";
      svg.appendChild(t);
    }
    const step = (2 * Math.PI) / slots;
    for (const g of groups) {
      const as = devs.filter((d) => d.group === g).map((d) => d.a);
      const a0 = Math.min(...as) - step * 0.4, a1 = Math.max(...as) + step * 0.4;
      const ra = rMax + 12;
      const pt = (a) => `${cx + ra * Math.cos(a)} ${cy + ra * Math.sin(a)}`;
      svg.appendChild(svgEl("path", { d: `M ${pt(a0)} A ${ra} ${ra} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}`,
        class: "sector", stroke: g.color || "var(--primary-color)" }));
    }
    const labelX = { r: cx + rMax + 24, l: cx - rMax - 24 };
    for (const d of devs) {
      const n = d.n;
      const els = { node: n };
      const lx = labelX[d.side];
      const ly = d.ly + ROWH / 2;
      svg.appendChild(svgEl("path", { class: "leader",
        d: `M ${d.x} ${d.y} L ${lx + (d.side === "r" ? -8 : 8)} ${ly} L ${lx + (d.side === "r" ? -3 : 3)} ${ly}` }));
      // spoke from the hub to the device, a lane on each side: down outwards, up inwards
      const ux = Math.cos(d.a), uy = Math.sin(d.a);
      const sx = cx + (R + 2) * ux, sy = cy + (R + 2) * uy;
      const ex = d.x - (NODE_R + 1) * ux, ey = d.y - (NODE_R + 1) * uy;
      const lane = (o) => `M ${sx - uy * o} ${sy + ux * o} L ${ex - uy * o} ${ey + ux * o}`;
      svg.appendChild(svgEl("path", { d: lane(0), class: "spoke" }));
      els.down = svgEl("path", { d: lane(-2.5), class: "lane down" });
      els.up = svgEl("path", { d: lane(2.5), class: "lane up" });
      svg.appendChild(els.down);
      svg.appendChild(els.up);
      const color = d.group.color || "var(--primary-color)";
      const g = svgEl("g", { class: "dev", style: "--nfc-node: " + color });
      g.appendChild(svgEl("circle", { cx: d.x, cy: d.y, r: NODE_R, fill: color }));
      const open = () => this._openPanel(n, { y: Math.max(d.y, ly) });
      g.addEventListener("click", open);
      svg.appendChild(g);
      const label = document.createElement("div");
      label.className = "clabel " + d.side;
      label.style.top = d.ly + "px";
      label.style.width = colW + "px";
      label.style.left = (d.side === "r" ? lx : lx - colW) + "px";
      label.innerHTML = `<div></div><div class="r"><span class="d"></span> <span class="u"></span> <span></span></div>`;
      label.firstChild.textContent = n.name;
      label.title = n.name;
      label.addEventListener("click", open);
      area.appendChild(label);
      const spans = label.querySelectorAll(".r span");
      els.rateD = spans[0];
      els.rateU = spans[1];
      els.note = spans[2];
      els.circle = g;
      els.name = label;
      this._els[n.id] = els;
    }
    const root = this._nodes[0];
    const hub = document.createElement("div");
    hub.className = "node";
    hub.style.left = cx + "px";
    hub.style.top = cy + "px";
    hub.style.setProperty("--nfc-node", root.color || "var(--primary-color)");
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", root.icon || "mdi:wifi");
    hub.appendChild(icon);
    area.appendChild(hub);
  }

  _more(entityId) {
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  // History panel: down above the axis, up below it, signal underneath (clients). A client's data comes from its
  // sensors (automation "AmpliFi client sensors"), any other node's from its down / up sensors.
  _openPanel(n, p) {
    const card = this.shadowRoot.querySelector("ha-card");
    if (this._panel) this._panel.remove();
    clearInterval(this._panelTimer);
    if (this._panelFor === n.id) { this._panelFor = null; this._panel = null; return; }
    this._panelFor = n.id;
    const hass = this._hass;
    const panel = document.createElement("div");
    panel.className = "panel";
    const area = this.shadowRoot.querySelector(".area");
    panel.style.top = area.offsetTop + p.y + (n._client ? 22 : this._r + (this._compact ? 62 : 40)) + "px";
    let facts, ids;
    if (n._client) {
      const st = hass.states[n._client];
      const a = st ? st.attributes : {};
      facts = [a.Address || a.ip, a.SignalQuality !== undefined ? "signal " + a.SignalQuality + "%" : null,
        a.RxBitrate ? "link " + rate(a.RxBitrate / 1000, true) : null, a.Mode, a.mac];
      // The client's sensors: the MQTT device with identifier amplifi_client_<key>.
      const key = n._client.slice(15).replace(/^amplifi_/, "");
      const dev = Object.values(hass.devices || {}).find((d) =>
        (d.identifiers || []).some((i) => i[0] === "mqtt" && i[1] === "amplifi_client_" + key));
      const mine = dev ? Object.values(hass.entities || {}).filter((e) => e.device_id === dev.id) : [];
      // two trackers with the same name give "..._down" and "..._down_2"
      const pick = (kind) => (mine.find((e) => new RegExp("_" + kind + "(_\\d+)?$").test(e.entity_id)) || {}).entity_id;
      ids = { down: pick("down"), up: pick("up"), signal: pick("signal") };
    } else {
      const link = n.link && hass.states[n.link] ? "link " + hass.states[n.link].state : null;
      const parent = this._nodes.find((m) => m.id === n.parent);
      facts = [n.note, parent ? "cable from " + (parent.name || parent.id) : null, link];
      ids = { down: n.down, up: n.up };
    }
    facts = facts.filter((x) => x);
    // values in Mbit/s, from each sensor's unit
    const factor = (id) => {
      const u = hass.states[id] && hass.states[id].attributes.unit_of_measurement;
      // client sensors are kbit/s (automation "AmpliFi client sensors"); others Mbit/s unless the unit says else
      return UNIT_TO_MBIT[u] === undefined ? (n._client ? 1e-3 : 1) : UNIT_TO_MBIT[u];
    };
    panel.innerHTML = `<div class="top" title="drag to move"><b></b><button class="x" title="close">\u00d7</button></div>
      <div class="facts"></div><div class="fields"></div><div class="ranges"></div><div class="chart"></div>`;
    panel.querySelector("b").textContent = n.name;
    panel.querySelector(".facts").textContent = facts.join(", ");
    panel.querySelector(".x").addEventListener("click", () => this._openPanel(n, p));
    const ranges = panel.querySelector(".ranges");
    let hours = 24;
    // up to 24 h from the history (every state), longer from the hourly statistics (mean and max per hour)
    for (const [label, h] of [["1 h", 1], ["6 h", 6], ["24 h", 24], ["7 d", 168], ["30 d", 720]]) {
      const b = document.createElement("button");
      b.textContent = label;
      b.classList.toggle("on", h === hours);
      b.addEventListener("click", () => {
        hours = h;
        ranges.querySelectorAll("button:not(.more)").forEach((x) => x.classList.toggle("on", x === b));
        load();
      });
      ranges.appendChild(b);
    }
    if (n._client) {
      // the tracker's raw fields right here (HA's own dialog would only show home / away)
      const more = document.createElement("button");
      more.className = "more";
      more.textContent = "all fields";
      more.title = "everything the router reports for this device";
      const box = panel.querySelector(".fields");
      more.addEventListener("click", () => {
        const st = this._hass.states[n._client];
        box.innerHTML = "";
        for (const [k, v] of Object.entries(st ? st.attributes : {}).sort(([a], [b]) => a.localeCompare(b))) {
          if (["friendly_name", "icon", "entity_picture"].includes(k)) continue;
          const key = document.createElement("span");
          key.textContent = k;
          const val = document.createElement("span");
          val.textContent = typeof v === "object" ? JSON.stringify(v) : String(v);
          box.append(key, val);
        }
        box.classList.toggle("open");
        more.classList.toggle("on", box.classList.contains("open"));
      });
      ranges.appendChild(more);
    } else if (n.entity) {
      const more = document.createElement("button");
      more.className = "more";
      more.textContent = "details";
      more.title = n.entity;
      more.addEventListener("click", () => this._more(n.entity));
      ranges.appendChild(more);
    }
    const chart = panel.querySelector(".chart");
    const load = async () => {
      if (!ids.down && !ids.up) {
        chart.innerHTML = n._client ? `<div class="msg">No history yet: this device has no sensors from the
          automation "AmpliFi client sensors" (new devices get them within 15 min).</div>`
          : `<div class="msg">No sensors for this cable.</div>`;
        return;
      }
      const end = new Date();
      const start = new Date(end.getTime() - hours * 3600e3);
      try {
        const wanted = Object.values(ids).filter((x) => x);
        const series = {};
        if (hours <= 24) {
          const res = await this._hass.callWS({
            type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
            entity_ids: wanted, minimal_response: true, no_attributes: true, significant_changes_only: false,
          });
          for (const [k, id] of Object.entries(ids)) {
            const f = k === "signal" ? 1 : factor(id);
            series[k] = (res[id] || []).map((x) => [(x.lu || x.lc) * 1000, parseFloat(x.s) * f]);
          }
        } else {
          const res = await this._hass.callWS({
            type: "recorder/statistics_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
            statistic_ids: wanted, period: "hour", types: ["mean", "max"],
          });
          for (const [k, id] of Object.entries(ids)) {
            const f = k === "signal" ? 1 : factor(id);
            series[k] = { stats: (res[id] || []).map((x) => ({ t: x.start, mean: x.mean * f, peak: (x.max ?? x.mean) * f })) };
          }
        }
        if (this._panelFor !== n.id) return;
        this._drawHistory(chart, series, start.getTime(), end.getTime());
      } catch (e) {
        chart.innerHTML = `<div class="msg"></div>`;
        chart.firstChild.textContent = "History failed: " + (e.message || e.code || e);
      }
    };
    chart.innerHTML = `<div class="msg">loading</div>`;
    card.appendChild(panel);
    this._panel = panel;
    // Above the node when it doesn't fit below it inside the card; then scrolled into view.
    const below = parseFloat(panel.style.top);
    if (below + panel.offsetHeight > card.offsetHeight) {
      const above = area.offsetTop + p.y - (n._client ? 22 : this._r + 8) - panel.offsetHeight;
      panel.style.top = Math.max(4, above) + "px";
    }
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this._dragPanel(panel);
    load();
    this._panelTimer = setInterval(() => { if (this._panel === panel && panel.isConnected) load(); }, 30000);
  }

  // Values per time bucket: the mean and the peak of the states that were valid in it (a state holds until the next).
  _buckets(points, t0, t1, n) {
    const out = [];
    const w = (t1 - t0) / n;
    if (points && points.stats) {
      // hourly statistics: each row into the bucket of its start time
      for (let b = 0; b < n; b++) out.push(null);
      for (const r of points.stats) {
        const b = Math.floor((r.t - t0) / w);
        if (b < 0 || b >= n || r.mean === null || r.mean === undefined) continue;
        const o = out[b] || (out[b] = { sum: 0, k: 0, mean: 0, peak: 0 });
        o.sum += r.mean; o.k++; o.mean = o.sum / o.k; o.peak = Math.max(o.peak, r.peak ?? r.mean);
      }
      return out;
    }
    points = points || [];
    let i = 0, last = null;
    while (i < points.length && points[i][0] <= t0) { last = points[i][1]; i++; }
    for (let b = 0; b < n; b++) {
      const bs = t0 + b * w, be = bs + w;
      let sum = 0, peak = null, covered = 0, t = bs;
      const add = (v, until) => {
        if (v !== null && isFinite(v)) { sum += v * (until - t); covered += until - t; peak = Math.max(peak ?? v, v); }
        t = until;
      };
      while (i < points.length && points[i][0] < be) { add(last, points[i][0]); last = points[i][1]; i++; }
      add(last, be);
      out.push(covered ? { mean: sum / covered, peak } : null);
    }
    return out;
  }

  // Drag the panel by its title bar (mouse or finger), kept inside the card.
  _dragPanel(panel) {
    const bar = panel.querySelector(".top");
    const card = { get offsetWidth() { return panel.parentNode ? panel.parentNode.offsetWidth : 0; },
                   get offsetHeight() { return panel.parentNode ? panel.parentNode.offsetHeight : 0; } };
    // the card clips what sticks out: when the panel grows (chart loaded, fields opened), move it up to stay inside
    new ResizeObserver(() => {
      const over = panel.offsetTop + panel.offsetHeight - (card.offsetHeight - 4);
      if (over > 0) panel.style.top = Math.max(0, panel.offsetTop - over) + "px";
    }).observe(panel);
    bar.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      ev.preventDefault();
      const x0 = ev.clientX, y0 = ev.clientY, l0 = panel.offsetLeft, t0 = panel.offsetTop;
      // from "centered with margins" to an explicit position and width
      panel.style.width = panel.offsetWidth + "px";
      panel.style.right = "auto";
      panel.style.margin = "0";
      panel.style.left = l0 + "px";
      try { bar.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic events have no pointer */ }
      const move = (e) => {
        const left = Math.min(Math.max(0, l0 + e.clientX - x0), card.offsetWidth - panel.offsetWidth);
        const top = Math.max(0, Math.min(t0 + e.clientY - y0, card.offsetHeight - panel.offsetHeight - 4));
        panel.style.left = left + "px";
        panel.style.top = top + "px";
      };
      const up = () => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
  }

  _drawHistory(chart, series, t0, t1) {
    const W = Math.max(240, chart.clientWidth || 300), H = 150, SH = series.signal ? 34 : 4, L = 44, B = 16;
    const n = series.down && series.down.stats ? Math.min(240, Math.ceil((t1 - t0) / 3600e3))
      : Math.min(240, Math.floor((W - L) / 2));
    const d = this._buckets(series.down, t0, t1, n), u = this._buckets(series.up, t0, t1, n);
    const sig = this._buckets(series.signal, t0, t1, n);
    // Values in Mbit/s. Own scale for each half, with a round top: 1, 2, 5 x 10^n.
    const scale = (b) => {
      const peak = Math.max(0.001, ...b.map((p) => (p ? p.peak : 0)));
      const mag = Math.pow(10, Math.floor(Math.log10(peak)));
      return [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= peak);
    };
    const topD = scale(d), topU = scale(u);
    const mid = H / 2;
    const x = (i) => L + ((i + 0.5) / n) * (W - L);
    const yD = (v) => mid - (v / topD) * (mid - 6);
    const yU = (v) => mid + (v / topU) * (mid - 6);
    const area = (b, y, key) => {
      let path = "", open = false;
      b.forEach((p, i) => {
        if (!p) { if (open) path += ` L ${x(i - 1)} ${mid} Z`; open = false; return; }
        path += (open ? " L " : ` M ${x(i)} ${mid} L `) + `${x(i)} ${y(p[key])}`;
        open = true;
      });
      if (open) path += ` L ${x(b.length - 1)} ${mid} Z`;
      return path;
    };
    const svg = svgEl("svg", { width: W, height: H + SH + B, viewBox: `0 0 ${W} ${H + SH + B}` });
    const kb = (v) => rate(v, true);
    for (const [y, t] of [[6, DOWN + " " + kb(topD)], [mid, "0"], [H - 6, UP + " " + kb(topU)]]) {
      svg.appendChild(svgEl("line", { x1: L, x2: W, y1: y, y2: y, class: "grid" }));
      const lab = svgEl("text", { x: L - 4, y: y + 3, class: "axis", "text-anchor": "end" });
      lab.textContent = t;
      svg.appendChild(lab);
    }
    const down = "var(--nfc-down, #29b6f6)", up = "var(--nfc-up, #ffa726)";
    svg.appendChild(svgEl("path", { d: area(d, yD, "peak"), fill: down, opacity: 0.25 }));
    svg.appendChild(svgEl("path", { d: area(d, yD, "mean"), fill: down, opacity: 0.85 }));
    svg.appendChild(svgEl("path", { d: area(u, yU, "peak"), fill: up, opacity: 0.25 }));
    svg.appendChild(svgEl("path", { d: area(u, yU, "mean"), fill: up, opacity: 0.85 }));
    // signal, 0 to 100 % (clients only)
    const s0 = H + 6;
    if (series.signal) svg.appendChild(svgEl("line", { x1: L, x2: W, y1: s0 + SH - 4, y2: s0 + SH - 4, class: "grid" }));
    const sl = svgEl("text", { x: L - 4, y: s0 + SH / 2, class: "axis", "text-anchor": "end" });
    sl.textContent = "signal";
    if (series.signal) svg.appendChild(sl);
    let sp = "";
    sig.forEach((p, i) => { if (p) sp += (sp && sig[i - 1] ? " L " : " M ") + `${x(i)} ${s0 + (SH - 4) * (1 - p.mean / 100)}`; });
    if (sp) svg.appendChild(svgEl("path", { d: sp, fill: "none", stroke: "var(--secondary-text-color)", "stroke-width": 1.5 }));
    const lastSig = [...sig].reverse().find((p) => p);
    if (lastSig) {
      const t = svgEl("text", { x: W, y: s0 + 8, class: "axis", "text-anchor": "end" });
      t.textContent = Math.round(lastSig.mean) + "%";
      svg.appendChild(t);
    }
    // time labels: start, middle, now
    const fmtT = (t) => {
      const dt = new Date(t);
      return t1 - t0 > 864e5 * 1.5 ? dt.toLocaleDateString(undefined, { day: "numeric", month: "numeric" })
        : dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    };
    [[L, t0, "start"], [(L + W) / 2, (t0 + t1) / 2, "middle"], [W, t1, "end"]].forEach(([tx, t, anchor]) => {
      const lab = svgEl("text", { x: tx, y: H + SH + B - 2, class: "axis", "text-anchor": anchor });
      lab.textContent = fmtT(t);
      svg.appendChild(lab);
    });
    // Hover (or touch): a line at the pointer and a box with the time and the values of that time slot.
    const cursor = svgEl("line", { y1: 0, y2: H + SH, class: "cursor" });
    svg.appendChild(cursor);
    const hit = svgEl("rect", { x: L, y: 0, width: W - L, height: H + SH, fill: "transparent" });
    svg.appendChild(hit);
    const tip = document.createElement("div");
    tip.className = "hover";
    const slot = (t1 - t0) / n;
    const fmtFull = (t) => new Date(t).toLocaleString(undefined, t1 - t0 > 864e5 * 1.5
      ? { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" });
    const show = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ev.clientX - box.left;
      const i = Math.min(n - 1, Math.max(0, Math.floor(((px - L) / (W - L)) * n)));
      const v = (b, f) => (b[i] ? f(b[i]) : "-");
      cursor.setAttribute("x1", x(i));
      cursor.setAttribute("x2", x(i));
      cursor.style.display = "block";
      tip.innerHTML = "";
      const line = (cls, text) => {
        const div = document.createElement("div");
        if (cls) div.className = cls;
        div.textContent = text;
        tip.appendChild(div);
      };
      line("", fmtFull(t0 + i * slot) + (slot >= 120e3 ? " - " + fmtFull(t0 + (i + 1) * slot).split(", ").pop() : ""));
      line("d", DOWN + " " + v(d, (p) => kb(p.mean) + " (peak " + kb(p.peak) + ")"));
      line("u", UP + " " + v(u, (p) => kb(p.mean) + " (peak " + kb(p.peak) + ")"));
      if (series.signal) line("", "signal " + v(sig, (p) => Math.round(p.mean) + "%"));
      tip.style.display = "block";
      const left = x(i) + 10 + tip.offsetWidth > W ? x(i) - 10 - tip.offsetWidth : x(i) + 10;
      tip.style.left = Math.max(0, left) + "px";
    };
    const hide = () => { cursor.style.display = "none"; tip.style.display = "none"; };
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", hide);
    chart.innerHTML = "";
    chart.appendChild(svg);
    chart.appendChild(tip);
    const sum = (b) => b.filter((p) => p).reduce((s, p) => s + p.mean, 0) / Math.max(1, b.filter((p) => p).length);
    const note = document.createElement("div");
    note.className = "facts";
    note.textContent = `average ${DOWN} ${kb(sum(d))} ${UP} ${kb(sum(u))}, peak ${DOWN} ${kb(Math.max(0, ...d.map((p) => (p ? p.peak : 0))))} ` +
      `${UP} ${kb(Math.max(0, ...u.map((p) => (p ? p.peak : 0))))}; solid = average, light = peak`;
    chart.appendChild(note);
  }

  _lane(el, v, idle) {
    const on = v !== null && v >= (idle || IDLE);
    el.classList.toggle("on", on);
    if (!on) return;
    const width = Math.min(9, 2 + 1.6 * Math.log2(1 + v));
    const speed = 14 + 22 * Math.log2(1 + v); // px per second
    el.style.strokeWidth = width;
    el.style.strokeDasharray = `0.1 ${DOT_GAP}`;
    el.style.animationDuration = (DOT_GAP / speed).toFixed(3) + "s";
  }

  _update() {
    if (!this._built || !this._hass) return;
    const hass = this._hass;
    const idle = this._config.idle_mbit || IDLE;
    for (const n of this._nodes) {
      const els = this._els[n.id];
      if (!els) continue;
      if (els.note && n._client) {
        const st = hass.states[n._client];
        const q = st && st.attributes.SignalQuality;
        els.note.textContent = q === undefined || q === null ? "" : (this._compact ? "" : "signal ") + q + "%";
      }
      if (els.note && n.note_entity) {
        const st = hass.states[n.note_entity];
        const t = !st ? "" : n.note_attribute ? st.attributes[n.note_attribute] : st.state;
        els.note.textContent = t === undefined || t === null ? n.note || "" : String(t);
      }
      if (!n.parent) continue;
      const d = this._rate(n, "down");
      const u = this._rate(n, "up");
      const link = n.link && hass.states[n.link] ? hass.states[n.link].state : null;
      const key = `${d}|${u}|${link}`;
      if (this._last[n.id] === key) continue;
      this._last[n.id] = key;
      this._lane(els.down, d, idle);
      this._lane(els.up, u, idle);
      els.rateD.textContent = (n.down || n._client ? DOWN + " " + rate(d, this._compact) : "");
      els.rateU.textContent = (n.up || n._client ? UP + " " + rate(u, this._compact) : "");
      if (n._client) {
        // only the directions with traffic; "idle" when neither has any
        els.rateD.textContent = d >= 0.0005 ? DOWN + " " + rate(d, this._compact) : "";
        els.rateU.textContent = u >= 0.0005 ? UP + " " + rate(u, this._compact) : "";
        const none = !els.rateD.textContent && !els.rateU.textContent;
        if (none) els.rateD.textContent = "idle";
        els.rateD.classList.toggle("none", none);
        const still = (d || 0) + (u || 0) < idle;
        els.circle.classList.toggle("idle", still);
        els.name.classList.toggle("idle", still);
      }
      els.circle.classList.toggle("off", link === "down");
      els.circle.classList.toggle("busy", Math.max(d || 0, u || 0) >= (this._config.busy_mbit || 5));
    }
    const first = this._config.down ? this._config : this._nodes.find((n) => n.parent === this._nodes[0].id && n.down);
    const inet = this.shadowRoot.getElementById("inet");
    if (first && inet) {
      inet.innerHTML = `${DOWN} <b>${rate(mbit(hass, first.down))}</b> ${UP} <b>${rate(mbit(hass, first.up))}</b>`;
    }
    const lat = this.shadowRoot.getElementById("lat");
    if (lat && this._config.latency) {
      const st = hass.states[this._config.latency];
      lat.innerHTML = st ? `ping <b>${fmt(parseFloat(st.state))}</b> ms` : "";
    }
  }
}


// ---- visual editor ----------------------------------------------------------------------------------------------
// HA's card editor shows this instead of YAML. Card options in one ha-form, then one collapsible section per node.
// ha-form and its pickers are lazy-loaded by HA; loading the entities card's editor makes sure they exist.
async function loadHaForm() {
  if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
  try {
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: "entities", entities: [] });
    await card.constructor.getConfigElement();
  } catch (e) { /* the editor still renders; HA falls back to YAML if ha-form is missing */ }
}

const LABELS = {
  title: "Title", layout: "Layout", down: "Down sensor (towards it)", up: "Up sensor (away from it)",
  latency: "Ping sensor (ms)", busy_mbit: "Glow from (Mbit/s)", idle_mbit: "Dots from (Mbit/s)",
  id: "ID", name: "Name", parent: "Parent", icon: "Icon", color: "Color (#rrggbb)", link: "Link sensor",
  entity: "Details entity", note: "Note (fixed text)", note_entity: "Note from entity", note_attribute: "Attribute",
  clients: "Find clients automatically (AmpliFi trackers)", prefix: "IP prefix, e.g. 192.168.1.",
  exclude: "Leave out",
};
const HELPERS = {
  down: "Traffic from the parent to this node", up: "Traffic from this node to the parent",
  link: "A state of \"down\" dims the node", entity: "Opened by \"details\" in the history panel",
  layout: "Radial needs nodes that find their clients", idle_mbit: "Below this a cable has no dots",
};
const sensor = { entity: { domain: "sensor" } };
const CARD_SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "layout", selector: { select: { mode: "dropdown", options: [
    { value: "tree", label: "Tree" }, { value: "radial", label: "Radial" }] } } },
  { type: "grid", name: "", schema: [{ name: "down", selector: sensor }, { name: "up", selector: sensor }] },
  { name: "latency", selector: sensor },
  { type: "grid", name: "", schema: [
    { name: "busy_mbit", selector: { number: { min: 0, step: 0.1, mode: "box" } } },
    { name: "idle_mbit", selector: { number: { min: 0, step: 0.001, mode: "box" } } }] },
];

function nodeSchema(node, nodes) {
  const root = node === nodes[0];
  // a node can't hang below itself or below one of its own children
  const below = new Set([node.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) if (n.parent && below.has(n.parent) && !below.has(n.id)) { below.add(n.id); grew = true; }
  }
  const parents = nodes.filter((n) => !below.has(n.id)).map((n) => ({ value: n.id, label: n.name || n.id }));
  return [
    { type: "grid", name: "", schema: [
      { name: "id", required: true, selector: { text: {} } }, { name: "name", selector: { text: {} } }] },
    ...(root ? [] : [{ name: "parent", required: true, selector: { select: { mode: "dropdown", options: parents } } }]),
    { type: "grid", name: "", schema: [{ name: "icon", selector: { icon: {} } }, { name: "color", selector: { text: {} } }] },
    ...(root ? [] : [
      { type: "grid", name: "", schema: [{ name: "down", selector: sensor }, { name: "up", selector: sensor }] },
      { name: "link", selector: { entity: {} } }]),
    { name: "entity", selector: { entity: {} } },
    { name: "note", selector: { text: {} } },
    { type: "grid", name: "", schema: [
      { name: "note_entity", selector: { entity: {} } },
      { name: "note_attribute", selector: { attribute: {} }, context: { filter_entity: "note_entity" } }] },
    ...(root ? [] : [{ name: "clients", type: "expandable", title: LABELS.clients, schema: [
      { name: "prefix", selector: { text: {} } }, { name: "icon", selector: { icon: {} } },
      { name: "exclude", selector: { entity: { multiple: true, domain: "device_tracker" } } }] }]),
  ];
}

// Drop what the forms leave behind when a field is cleared: "", undefined, [], {} (also inside clients).
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === undefined || v === null) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const c = clean(v);
      if (Object.keys(c).length) out[k] = c;
      continue;
    }
    out[k] = v;
  }
  return out;
}

class LanFlowCardEditor extends HTMLElement {
  setConfig(config) {
    const next = JSON.parse(JSON.stringify(config || {}));
    next.nodes = next.nodes || [];
    const shape = (c) => c.nodes.map((n) => n.id).join("|");
    const rebuild = !this._config || shape(this._config) !== shape(next);
    this._config = next;
    if (rebuild) this._build(); else this._refresh();
  }

  set hass(hass) {
    this._hass = hass;
    for (const f of this._forms || []) f.hass = hass;
  }

  connectedCallback() {
    if (!this._loaded) {
      this._loaded = true;
      loadHaForm().then(() => this._build());
    }
  }

  _emit() {
    const config = { ...this._config, nodes: this._config.nodes.map((n) => clean(n)) };
    if (config.layout === "tree") delete config.layout;  // the default; shown in the form, not written
    const ev = new Event("config-changed", { bubbles: true, composed: true });
    ev.detail = { config: clean({ ...config, nodes: undefined }) };
    ev.detail.config.nodes = config.nodes;
    this.dispatchEvent(ev);
  }

  _form(schema, data, onChange) {
    const f = document.createElement("ha-form");
    f.hass = this._hass;
    f.schema = schema;
    f.data = data;
    f.computeLabel = (s) => LABELS[s.name] || s.title || s.name;
    f.computeHelper = (s) => {
      if (s.name === "layout" && !(this._config.nodes || []).some((n) => n.clients)) {
        return "Radial arranges the clients that nodes find by themselves; this card has none, so it stays a tree";
      }
      return HELPERS[s.name];
    };
    f.addEventListener("value-changed", (ev) => { ev.stopPropagation(); onChange(ev.detail.value); });
    this._forms.push(f);
    return f;
  }

  // Update the forms in place (keeps focus while typing); only the parent lists and titles can change.
  _refresh() {
    if (!this._nodeForms) return;
    this._cardForm.data = { layout: "tree", ...this._config };
    this._config.nodes.forEach((n, i) => {
      const f = this._nodeForms[i];
      if (!f) return;
      f.schema = nodeSchema(n, this._config.nodes);
      f.data = n;
      this._titles[i].textContent = (n.name || n.id) + (i === 0 ? " (root)" : "");
    });
  }

  _build() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = `<style>
      :host { display: block; }
      details { border: 1px solid var(--divider-color, #444); border-radius: 8px; margin: 8px 0; }
      summary { cursor: pointer; padding: 10px 12px; font-weight: 500; }
      .body { padding: 0 12px 12px; }
      .tools { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
      button { background: none; color: var(--primary-color); border: 1px solid var(--divider-color, #444);
               border-radius: 16px; padding: 4px 12px; font: inherit; cursor: pointer; }
      button:disabled { color: var(--disabled-text-color, #777); cursor: default; }
      h3 { font-size: 15px; font-weight: 500; margin: 18px 0 4px; }
    </style>`;
    this._forms = [];
    this._cardForm = this._form(CARD_SCHEMA, { layout: "tree", ...this._config }, (v) => {
      const nodes = this._config.nodes;
      this._config = { ...v, nodes };
      this._emit();
    });
    root.appendChild(this._cardForm);
    const h = document.createElement("h3");
    h.textContent = "Nodes (the first one is the root)";
    root.appendChild(h);
    this._nodeForms = [];
    this._titles = [];
    const nodes = this._config.nodes;
    nodes.forEach((n, i) => {
      const d = document.createElement("details");
      if (this._open === n.id) d.open = true;
      d.addEventListener("toggle", () => { if (d.open) this._open = this._config.nodes[i] && this._config.nodes[i].id; });
      const sum = document.createElement("summary");
      sum.textContent = (n.name || n.id) + (i === 0 ? " (root)" : "");
      this._titles.push(sum);
      d.appendChild(sum);
      const body = document.createElement("div");
      body.className = "body";
      const f = this._form(nodeSchema(n, nodes), n, (v) => this._nodeChanged(i, v));
      this._nodeForms.push(f);
      body.appendChild(f);
      const tools = document.createElement("div");
      tools.className = "tools";
      const btn = (label, disabled, fn) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.disabled = disabled;
        b.addEventListener("click", fn);
        tools.appendChild(b);
      };
      btn("Move up", i <= 1, () => this._move(i, -1));
      btn("Move down", i === 0 || i === nodes.length - 1, () => this._move(i, 1));
      btn("Add child", false, () => this._add(n.id));
      btn("Remove", i === 0, () => this._remove(i));
      body.appendChild(tools);
      d.appendChild(body);
      root.appendChild(d);
    });
    const add = document.createElement("button");
    add.textContent = nodes.length ? "Add node" : "Add root node";
    add.addEventListener("click", () => this._add(nodes.length ? nodes[0].id : null));
    root.appendChild(add);
  }

  _nodeChanged(i, value) {
    const nodes = this._config.nodes.map((n) => ({ ...n }));
    const old = nodes[i].id;
    nodes[i] = value;
    const id = (value.id || "").trim();
    // a new ID: children follow; an empty or taken one is not applied
    if (id && id !== old && !nodes.some((n, j) => j !== i && n.id === id)) {
      nodes[i].id = id;
      for (const n of nodes) if (n.parent === old) n.parent = id;
    } else {
      nodes[i].id = old;
    }
    this._open = nodes[i].id;
    this._config = { ...this._config, nodes };
    this._emit();
  }

  _move(i, dir) {
    const nodes = [...this._config.nodes];
    const j = i + dir;
    if (j < 1 || j >= nodes.length) return;
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    this._open = nodes[j].id;
    this._config = { ...this._config, nodes };
    this._build();
    this._emit();
  }

  _add(parent) {
    const nodes = [...this._config.nodes];
    let k = nodes.length + 1;
    while (nodes.some((n) => n.id === "node_" + k)) k++;
    const node = parent ? { id: "node_" + k, parent, name: "New node", icon: "mdi:lan" } : { id: "internet", name: "Internet", icon: "mdi:web" };
    nodes.push(node);
    this._open = node.id;
    this._config = { ...this._config, nodes };
    this._build();
    this._emit();
  }

  _remove(i) {
    const nodes = this._config.nodes.map((n) => ({ ...n }));
    const gone = nodes[i];
    nodes.splice(i, 1);
    for (const n of nodes) if (n.parent === gone.id) n.parent = gone.parent;  // children move up
    this._config = { ...this._config, nodes };
    this._build();
    this._emit();
  }
}

if (!customElements.get(NAME)) {
  customElements.define(NAME, LanFlowCard);
  customElements.define(NAME + "-editor", LanFlowCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: NAME,
    name: NAME === "lan-flow-card" ? "LAN flow card" : "LAN flow card (" + NAME + ")",
    description: "The network as a tree, cables with moving dots for live traffic.",
    preview: true,
  });
}
