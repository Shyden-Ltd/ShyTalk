# Preflight fixtures — provenance

Real captured output from the machine SHY-0263 was diagnosed on (8 GB Apple Silicon
Mac, macOS 27.0.0), 2026-07-31 ~16:30 WIB. These are test **data**, not mock
collaborators — permitted by the no-stubs rule for pure-logic unit tests.

Do not hand-edit. Re-capture with the commands below if they ever need refreshing,
and update this file's date.

| File                         | Command                                              |
| ---------------------------- | ---------------------------------------------------- |
| `ps-snapshot-2026-07-31.txt` | `ps -Ao pid=,ppid=,rss=,etime=,command=`             |
| `top-mem-2026-07-31.txt`     | `top -l 1 -o mem -n 25 -stats pid,mem,cmprs,command` |
| `physmem-2026-07-31.txt`     | `top -l 1 -n 0 \| grep -E 'PhysMem\|Load Avg'`       |

## What makes this snapshot useful

It was taken while the machine was in **exactly** the state the ticket describes,
so it contains both things the reclaimer has to get right:

**An orphan to catch** — `pid 94478`, `ppid=1`, a Gradle daemon 7m52s old. It was
spawned by `local/start.sh`'s step 8/8 Android install minutes earlier and
immediately detached to init. This is the bug, captured live.

**A live stack to protect** — all of which must survive reclamation:

| pid   | ppid  | role                              |
| ----- | ----- | --------------------------------- |
| 93796 | 93584 | `npm exec firebase`               |
| 93884 | 93796 | `firebase emulators:start`        |
| 94261 | 93884 | Firestore emulator JVM            |
| 94328 | 94326 | Express API (`node src/index.js`) |
| 94457 | 93584 | local web server (`serve-web.js`) |

## Why the RSS column is in here

To pin the trap, not because the code should use it. In this very snapshot:

- Gradle daemon 94478 — **53 MB RSS**, real footprint **464 MB+**
- Firestore emulator 94261 — **16 MB RSS**, real footprint **~765 MB**

Understated by 10–45×, and the ranking is inverted: sorting these by RSS puts the
two biggest memory consumers on the machine near the bottom. Anything that reads
RSS to decide what is using memory will reach the wrong answer.
See `[[feedback-measure-footprint-not-rss-under-memory-pressure]]`.
