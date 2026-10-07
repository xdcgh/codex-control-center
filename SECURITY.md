# Security and privacy

The application is local-first and sends no application analytics. It must not upload credentials, account identifiers, private prompts, thread content, session logs, absolute private paths, runtime databases, or raw diagnostics.

Recovery must fail closed when Desktop compatibility or thread ownership is unknown, the user has paused/stopped/finished work, an approval or decision is pending, or a previous send outcome is uncertain. The app never kills the Codex Desktop backend to acquire its threads.

Before any public push, scan every tracked file and reachable commit for secret material and private paths, review fixtures and screenshots, and verify dependencies' licenses. Runtime/configuration/diagnostics belong outside tracked source. Diagnostic exports use an allowlist of safe version/state/aggregate fields and redacted identifiers.

Please report suspected vulnerabilities privately to the repository maintainer through GitHub's private security reporting when enabled. Do not include live credentials or private conversation content in public issues.
