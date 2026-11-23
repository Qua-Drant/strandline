# Security policy

Strandline reads and changes files on your disks, so "security" here covers two things: **classic
vulnerabilities** (e.g. a crafted path that escapes the protected-path guard) and **data-safety bugs**
(anything that could make the app lose, damage or wrongly suggest removing your files).

## Safety model

1. **Read-only by default.** A fresh install scans only. Every write command is refused by the Rust
   backend while *read-only mode* is on, not just hidden in the UI. Undo (restoring from the Recycle Bin)
   is always allowed.
2. **Nothing is deleted permanently by default.** Cleaning, rules, duplicates and large files go to the
   Windows Recycle Bin. The one irreversible action — *Empty Recycle Bin* — is a separate, confirmed step
   and is refused when the scan target is a sandbox.
3. **No silent permanent deletes.** Windows permanently deletes items that exceed the Recycle Bin size
   limit (or every item when the bin is set to "don't move to the Recycle Bin"). Strandline checks the
   limit and that setting for each volume first and refuses such items instead.
4. **Protected paths are hard-coded** in [`src-tauri/src/guard.rs`](src-tauri/src/guard.rs): `Windows`,
   `Program Files*`, `ProgramData\Microsoft`, boot / recovery / system-volume folders, page, swap and
   hibernation files, registry hives, the Recycle Bin folders, drive roots, the user profile and its
   top-level folders (Desktop, Documents, Downloads…), and the app's own data folder. Paths are checked
   as given and again after resolving links; relative paths and `..` are refused. No setting or rule can
   widen what is allowed.
5. **Scanning never follows links** (symbolic links, junctions, mount points) and never opens cloud
   placeholders (OneDrive / iCloud online-only files) — opening them would download them. Placeholders
   are excluded from sizes, hashing, migration and rules.
6. **Migration never removes data before a verified copy exists.** Every file is hashed (BLAKE3) while
   copying and compared after a read-back; the old folder is renamed to a backup, replaced by a junction
   only if the copy is reachable through it, and then sent to the Recycle Bin (or kept on disk if the bin
   cannot hold it). An interrupted migration resumes from its journal; the source is untouched until the
   switch step.
7. **Local only.** No telemetry, no network calls from the backend. File contents are only read to hash
   duplicates and to verify migrations, on this machine.

## Reporting a vulnerability or data-safety bug

Please **do not open a public issue** for a guard bypass or anything that could delete or damage data.
Report it privately through GitHub: **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Include:

- Windows version, Strandline version, and whether you were in read-only mode;
- the path(s) involved (you may replace your user name), and what Strandline did versus what you expected;
- if possible, a reproduction inside a sandbox (`npm run sandbox`).

We aim to acknowledge reports within 7 days and to ship a fix or mitigation for confirmed data-safety
issues before anything else.

Cleaning suggestions that look wrong but did not cause damage (e.g. a folder you need marked as
"可重建") can be reported publicly with the *Cleaning rule false positive* issue template.

## Supported versions

Only the latest release receives fixes.
