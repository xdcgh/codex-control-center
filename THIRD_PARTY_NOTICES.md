# Third-party notices

The initial source import is the project's own legacy watchdog. No implementation code from the community reference projects was copied. Reference licenses, pinned revisions and architecture notes are documented separately in `docs/research.md`.

Codex is an OpenAI product; this project is unofficial. We refer to the public app-server protocol and independently implemented Windows Desktop IPC integration. The upstream [openai/codex](https://github.com/openai/codex) project is Apache-2.0 licensed. Any future code reuse must retain the relevant license and attribution.

The actual npm/Cargo lockfiles and redistributed Node.js runtime have been inventoried in [dependency license review](docs/dependency-licenses.md). Full license and copyright texts are supplied in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt), including the pinned Node.js runtime's own bundled notices. Package versions and upstream sources are listed there; build-only/conditional entries are distinguished from the active Windows graph.

`selectors` 0.38.0 is licensed under MPL-2.0. Its covered sources are unmodified in this project. The exact corresponding source archive and Cargo.lock checksum are recorded in the license bundle and review document; recipients can obtain the covered source from [the versioned crate archive](https://static.crates.io/crates/selectors/selectors-0.38.0.crate). The MPL-2.0 notice and full terms are included in the bundle. This project's own MIT license does not replace the licenses of covered dependency files.
