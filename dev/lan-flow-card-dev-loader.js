// Loader for testing a development copy of the card next to the released one, in the same Home Assistant.
// Copy this file and lan-flow-card.js (renamed lan-flow-card-dev.js) to /config/www/dev/, and add this loader as a
// dashboard resource: /local/dev/lan-flow-card-dev-loader.js (JavaScript module). It loads the dev copy fresh on
// every page load (no ?v= to raise) and registers it as `custom:lan-flow-card-dev`. See dev/README.md.
import(new URL("lan-flow-card-dev.js?name=lan-flow-card-dev&ts=" + Date.now(), import.meta.url).href);
