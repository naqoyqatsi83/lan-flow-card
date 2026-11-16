# Contributing

Bug reports and ideas are welcome as
[issues](https://github.com/naqoyqatsi83/lan-flow-card/issues/new/choose). For a
security problem, use the private report described in [SECURITY.md](SECURITY.md)
instead.

## Reporting a bug

Say which card version you run (HACS shows it, or the release tag you
installed), the Home Assistant version, your router or integration (for
`clients:`), and what you did, saw and expected. A screenshot and the card's
YAML help with anything visual. Remove IPs, hostnames, MAC addresses, SSIDs,
entity names and anything else from your home that you don't want public.

## Pull requests

Open an issue first for anything bigger than a small fix, so the change can be
agreed on before you write it. Pull requests go to the `dev` branch; `main`
only holds releases.

- Keep the tests passing (`bash tests/run.sh`, needs Python 3, Node and
  Chromium or Chrome); CI runs them on every pull request.
- One JavaScript file, no build step, no dependencies. Keep files ASCII.
- Examples and the demo use made-up names (`192.168.1.x`, "Laptop").
- Commit messages use conventional prefixes (`feat:`, `fix:`, `docs:`,
  `refactor:`, `chore:`), lowercase, with no period at the end, and name the
  issue in the body (`Closes #N`).
- Add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for
  anything a user would notice, in the imperative ("Add", "Fix").

See [demo](README.md#demo), [development](README.md#development) and
[tests](README.md#tests) in the README.
