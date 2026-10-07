# Windows build and package verification

Build on Windows x64 with Node.js **24.21.0**, Rust **1.99.0**, the MSVC C++ build tools and Windows SDK, and a WebView2 runtime. The Node version is the bundled runtime pin and is independently verified against its official digest. Use repository lockfiles; do not include local Codex authentication, sessions or runtime databases in build resources.

```powershell
npm ci
rustup toolchain install 1.99.0 --profile minimal
rustup default 1.99.0
npm run desktop:build -- --debug --no-bundle
$env:CODEX_CONTROL_CENTER_NATIVE_TEST_HELPER = (Resolve-Path 'src-tauri/target/debug/codex-control-center.exe').Path
npm test
npm run desktop:build -- --bundles nsis
```

If using `CARGO_TARGET_DIR`, use that directory for the built executable and native-helper override. The Tauri CLI build embeds the frontend; a direct Cargo development build can depend on the development web server. Core tests use temporary state and test helpers; they do not consume model quota or modify existing user threads.

`npm run desktop:build` runs the publication build wrapper. It maps project, Cargo, Rustup, profile and target source paths (including physical aliases) to neutral `/build/` paths before compiling Rust, and gives the Windows PDB reference a filename without a private directory. Existing compiler flags and paths containing spaces are retained through `CARGO_ENCODED_RUSTFLAGS`. Build through this wrapper rather than a raw Tauri/Cargo invocation when preparing public artifacts.

The NSIS installer is generated under `src-tauri/target/release/bundle/nsis/`. To assemble a portable directory, use an absolute path to the release executable:

```powershell
$releaseExe = (Resolve-Path 'src-tauri/target/release/codex-control-center.exe').Path
node scripts/prepare-run.mjs --exe $releaseExe --output artifacts/portable
Compress-Archive -LiteralPath (Get-ChildItem artifacts/portable | Select-Object -ExpandProperty FullName) -DestinationPath artifacts/codex-control-center-windows-x64-portable.zip
Get-FileHash artifacts/codex-control-center-windows-x64-portable.zip -Algorithm SHA256
```

The package contains the native executable, Node runtime, Core source, pricing snapshot and all required license/notice texts. Before publication, install the trusted locally built NSIS package into a **new test directory**, then compare that installed payload with the portable directory:

```powershell
node scripts/verify-installed-payload.mjs --installed NEW_TEST_INSTALL_DIRECTORY --portable artifacts/portable
npm run publication:check -- NEW_TEST_INSTALL_DIRECTORY artifacts/portable
```

The verifier requires equality of the payload file sets and bytes, except the generated uninstaller and portable manifests. The main executable permits only Tauri's unique NSIS/unknown bundle-type marker difference; any other executable difference fails. It checks the pinned Node digest, notice files, all five required PowerShell helpers, forbidden runtime-file names and ASCII/UTF-16 private-path content. The publication scanner also checks resolved local build roots. Scan extracted ZIP contents; the scanner rejects a ZIP passed as if it were an unpacked payload. These are artifact checks, not Windows reboot or natural quota-cycle tests.

The [Windows package workflow](../.github/workflows/desktop.yml) builds native tests and release artifacts, runs a fresh NSIS installation and payload comparison, and uploads installer/portable/SHA256 files. Source/history scanning and independent Windows/Linux tests run in the separate [Core workflow](../.github/workflows/ci.yml). Release publication remains a separate acceptance step. Current artifacts are unsigned; no signing certificate or credential is stored in the repository.
