# Dependency license audit

Audited against the checked-in `package-lock.json` (lockfile v3), `src-tauri/Cargo.lock`, and locked Cargo metadata filtered for `x86_64-pc-windows-msvc`. The Cargo command was `cargo metadata --locked --filter-platform x86_64-pc-windows-msvc --format-version 1`; it resolves metadata only and does not build. The audit also inspected installed npm package license files and the shipped Node sidecar license bundle. No dependencies were installed or changed.

## What ships

The frontend's four production npm dependencies are `@tauri-apps/api@2.12.1` (Apache-2.0 OR MIT), `react@19.3.0` (MIT), `react-dom@19.3.0` (MIT), and `scheduler@0.28.0` (MIT). The lock contains 83 packages with SPDX metadata: 4 production and 79 build/test-only. Production JS is included in the application bundle. The 79 development packages are not part of the intended runtime payload.

The locked Windows MSVC metadata contains 264 third-party package records plus this product; the active `cargo tree` for the default `x86_64-pc-windows-msvc` graph contains 240 third-party package versions plus this product. Cargo metadata/lock entries alone do not prove code is compiled into the app. For example, `tauri-plugin@2.7.1` is build-only, while `defmt-parser@1.0.0` is in the lock/metadata but absent from the active default Windows graph. `THIRD_PARTY_LICENSES.txt` inventories all lock/metadata records and includes the complete distinct license/notice texts found in the resolved crate archives, with crate name, version, SPDX expression, and crates.io/docs.rs source links. Repeated identical texts are included once. Seven crate archives have no license text file despite SPDX metadata; their exact package/version and upstream or canonical license texts are included with links. Do not treat a metadata declaration as evidence that a license file was present in the archive.

## Bundled Node.js

The shipped `.packaged/node.exe` is Node.js v24.21.0 for win32-x64. Its SHA-256 is `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32` as recorded in `.packaged/manifest.json`. `.packaged/node-LICENSE` is byte-for-byte identical to Node's official v24.21.0 `LICENSE` (SHA-256 `5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace`). It contains Node's MIT grant and bundled component notices, including notices with additional terms/exceptions. Ship this full file alongside the sidecar; do not replace it with a short MIT-only summary. The source is [Node.js v24.21.0 LICENSE](https://github.com/nodejs/node/blob/v24.21.0/LICENSE).

## Missing crate archive license files

These packages' published crate source directories lacked a `LICENSE`, `LICENCE`, `COPYING`, `NOTICE`, or `UNLICENSE` file. The stated SPDX expression comes from Cargo package metadata; use the linked upstream/canonical text for notice fulfillment and retain this disclosure:

| Package | Declared license | Source evidence |
|---|---|---|
| `alloc-stdlib@0.3.0` | BSD-3-Clause | Active normal dependency; [pinned source LICENSE](https://raw.githubusercontent.com/dropbox/rust-alloc-no-stdlib/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE). Crate checksum: `0b5c1865780388bfa186411ab5f247819487fc4864c6e9c3106611fa347586e1`. |
| `defmt-parser@1.0.0` | MIT OR Apache-2.0 | Not in active default Windows graph; lock/metadata only. [Pinned MIT](https://raw.githubusercontent.com/knurling-rs/defmt/4a8cdb44891ed57b8ff5a023b6bec7137c48708f/LICENSE-MIT), [Apache-2.0](https://raw.githubusercontent.com/knurling-rs/defmt/4a8cdb44891ed57b8ff5a023b6bec7137c48708f/LICENSE-APACHE). Crate checksum: `10d60334b3b2e7c9d91ef8150abfb6fa4c1c39ebbcf4a81c2e346aad939fee3e`. |
| `selectors@0.38.0` | MPL-2.0 | Active normal dependency through `dom_query`/`tauri-utils`; exact crate: [selectors-0.38.0.crate](https://static.crates.io/crates/selectors/selectors-0.38.0.crate), Cargo.lock SHA-256: `8adfa1c298912827b8a28b223b3b874357397ae706e6190acd9bf28cee99114d`. The crate archive and its pinned source tree contain no license text file; included full text is the [Mozilla canonical MPL-2.0 text](https://www.mozilla.org/media/MPL/2.0/index.815ca599c9df.txt). The unmodified crate source is available from the exact crate URL above; retain its MPL notice and make that source available with binary redistribution as required by MPL-2.0. |
| `tauri-plugin@2.7.1` | Apache-2.0 OR MIT | Build-only dependency of Tauri plugins; pinned source commit `30da1fd6e17de6107ecc850c95dfb16b5729f2dd`: [MIT](https://raw.githubusercontent.com/tauri-apps/tauri/30da1fd6e17de6107ecc850c95dfb16b5729f2dd/LICENSE-MIT), [Apache-2.0](https://raw.githubusercontent.com/tauri-apps/tauri/30da1fd6e17de6107ecc850c95dfb16b5729f2dd/LICENSE-APACHE-2.0). Crate checksum: `1140cf34a3b3b836a13103dcab17f18831d5cc3534cbd435dc01a5c6daa65aa2`. |
| `webview2-com@0.39.1`, `webview2-com-sys@0.39.1` | MIT | Active normal Windows dependencies; pinned source commit `edc2caf886175ccaebe86078c9cfe1ae2a187328`; [LICENSE](https://raw.githubusercontent.com/wravery/webview2-rs/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE). Crate checksums: `webview2-com` `3f89fca7a704cee10dcb3654c1dbb8941d1783132f1917358af75bec37a7d7e6`; `webview2-com-sys` `b3a07132775117d6065853d9d1178157b8c90e228de47129d6bce2c7edebedfb`. |
| `webview2-com-macros@0.8.1` | MIT | Active proc-macro dependency; pinned source commit `dffa41a8a46d3f5565eefbff2de57d38d399f158`; [LICENSE](https://raw.githubusercontent.com/wravery/webview2-rs/dffa41a8a46d3f5565eefbff2de57d38d399f158/LICENSE). Crate checksum: `67a921c1b6914c367b2b823cd4cde6f96beec77d30a939c8199bb377cf9b9b54`. |

`plist@1.10.1` has an actual license file named `LICENCE`; it is included. The application root's own MIT license is separate from third-party notices. The lock/metadata inventory is broader than the active compiled graph; runtime/build classification should be refreshed from `cargo tree` when Cargo features or target change.

## Distribution follow-through

Keep `THIRD_PARTY_LICENSES.txt` and `.packaged/node-LICENSE` in the redistributable installer. Re-run this audit whenever either lockfile, the shipped Node version, or packaging contents change. Npm's 79 development packages remain inventoried in the lock, but are not runtime redistributions unless a future packaging change starts shipping them.

## Package/source references

- [Cargo package index](https://crates.io/) and [published crate sources](https://docs.rs/)
- [npm package metadata](https://www.npmjs.com/)
- [Tauri API package](https://www.npmjs.com/package/@tauri-apps/api/v/2.12.1)
- [React](https://www.npmjs.com/package/react/v/19.3.0), [React DOM](https://www.npmjs.com/package/react-dom/v/19.3.0), [scheduler](https://www.npmjs.com/package/scheduler/v/0.28.0)
