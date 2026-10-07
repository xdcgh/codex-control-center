# Third-party notices

The initial source import is the project's own legacy watchdog. No implementation code from the community reference projects was copied. Reference licenses, pinned revisions and architecture notes are documented separately in `docs/research.md`.

Codex is an OpenAI product; this project is unofficial. We refer to the public app-server protocol and independently implemented Windows Desktop IPC integration. The upstream [openai/codex](https://github.com/openai/codex) project is Apache-2.0 licensed. Any future code reuse must retain the relevant license and attribution.

Runtime dependencies and redistributed binaries must have their licenses inventoried before packaging. The pinned Node.js runtime is distributed under the Node.js license, including its bundled third-party notices. React, Tauri, Rust crates and any chart/UI dependencies must be recorded from the actual lockfiles, rather than inferred from reference projects.
