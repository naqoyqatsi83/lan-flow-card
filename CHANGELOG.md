# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-19

### Added

- Draw the network as a tree of any depth from your own rate sensors, with moving dots on every cable for its live traffic, and convert each sensor's unit to Mbit/s
- Find Wi-Fi clients by themselves under a node with `clients:` (AmpliFi device trackers), with their rates and signal
- Find clients from the UniFi Network integration too (Wi-Fi and wired, rates from their RX / TX sensors), and narrow them down by SSID, access point or connection (#2)
- Add a radial view (`layout: radial`) with the access point in the middle and a sector per network, and say why it can't be drawn when it can't
- Open a history panel with a tap on any node: 1-24 h from the recorder history, 7-30 d from hourly statistics, values on hover, a signal strip, and "all fields": everything the router reports for a client, or a node's sensors and the rest of their device (#1). Drag it by its title; it stays open when devices join or leave
- Add a visual editor for the card options and the nodes
- Take the element name from the module URL, so a development copy runs next to the release (`dev/`)

[Unreleased]: https://github.com/naqoyqatsi83/lan-flow-card/compare/v0.1.0...dev
[0.1.0]: https://github.com/naqoyqatsi83/lan-flow-card/releases/tag/v0.1.0
