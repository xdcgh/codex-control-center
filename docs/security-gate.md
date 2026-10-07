# Publication security gate

Updated 2026-10-07. This record covers source publication; it is separate from product and release acceptance.

| Gate | Result | Evidence and limits |
| --- | --- | --- |
| Original workspace history | Excluded from public import | Retained locally for rollback; original documentation contained private user paths |
| New repository history | PASS | Gitleaks 8.30.1 scanned all reachable initial commits with full redaction; zero detected leaks |
| Publishable working files | PASS | Gitleaks 8.30.1 directory scan; zero detected leaks |
| Profile/workspace/toolchain private paths | PASS | Reviewed publishable source/docs; no private profile/workspace/toolchain paths found |
| Fixtures and smoke helpers | PASS for initial import | Synthetic fixture IDs; live IDs are runtime-only values. Smoke receipts are outside tracked source |
| Runtime, auth, diagnostics and databases | Excluded | Git ignore rules plus explicit tracked-file review; no application runtime imported |
| Reference licenses | Reviewed | Eleven pinned repositories; unlicensed-at-pin code remains reference-only; no community implementation copied |
| Dependency/package inventory | Pending | Must scan actual lockfiles and redistributed runtimes before release |
| Screenshots | Pending | Public screenshots must use synthetic data or privacy mode and receive visual review |

Gitleaks archives were downloaded from the official project release and verified against its published SHA256 list before execution. Raw scan reports are kept privately outside this repository. A zero result is evidence of this scan, not a guarantee that arbitrary future commits are safe.

Repeat changed-source and reachable-history scans before public pushes. Do not include raw secrets or private diagnostic content in scanner output or public reports. New distribution binaries, installer contents and generated screenshots require their own publication review.
