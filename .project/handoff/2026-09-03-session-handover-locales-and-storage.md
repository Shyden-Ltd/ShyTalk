# Handover — 2026-09-03 (laptop restart)

Everything below is **pushed or merged**. The working tree was clean at the
restart; nothing is only on this machine.

## Merged to develop today

| PR | Story | What |
| --- | --- | --- |
| #2124 | SHY-0470 | Removed the moderation-queue client API that lost its caller |
| #2125 | SHY-0444 | A failed image looks like an absent one (12 screens) |
| #2126 | SHY-0497 | Sign-out completes before navigating to sign-in |
| #2128 | **SHY-0501** | **Storage socket leak — a production bug** |
| #2130 | SHY-0448 | `public/` linted AND format-checked; the tree formatted once |
| #2131 | **SHY-0289** | **Five locales, not twenty** |

## Still open

- **#2129 — SHY-0500** (instant cold-start). Android AND iOS both draw
  immediately now. Last CI run had `test-backend` red on **locale parity**: the
  story adds one English string and #2131 had not merged yet. **It should be
  re-run now that #2131 is on develop** — merge develop in first (do NOT rebase,
  the branch is pushed).

## The two findings that matter more than the tickets

**SHY-0501 — leaked storage connections take production down silently.**
`GET /api/admin/backups` hung forever. The process held exactly **50** sockets to
storage in `CLOSE_WAIT` — the AWS SDK's default `maxSockets` — after 3 days 21
hours up. Four routes piped an R2 body to the client and dropped it when the
client left first; nothing closed this side. With no timeout configured, an
exhausted pool waited forever rather than failing. Same code runs against
Cloudflare R2 in production, where the symptom is attachments, exports AND
backups dying together with nothing in the logs until somebody restarts the API.
Fixed at all four sites plus bounded timeouts.

**SHY-0502 (P1, filed, not started) — a safety document nobody can read.**
Every legal section in `LEGAL_T` carries all locales except `cyber`, which
carried only `ar`, `de`, `km` — **none of the five ShyTalk ships**. The
cyber-bullying policy, the page a bullied minor is pointed at, is translated
into no supported language, and already was not for four of the five before the
retirement. It hid because one test picked a single locale to prove the page
translates and picked one of the three now retired. Its test is `fixme` pointing
at the story rather than deleted: the coverage is right, the product is wrong.

## Owed (device work — needs the phones)

- **SHY-0500**: signed in / signed out / revoked / offline, on both phones,
  watching what is drawn FIRST.
- **SHY-0289**: a phone set to a retired language renders English; no
  untranslated key on a real device in any of the five.
- **SHY-0501**: close a reported video part-way several times, then confirm
  attachments and the Backups tab still work.

## Local stack

Running before the restart and will need starting again: `bash local/start.sh`.
It is a foreground supervisor. Note the express-api process it starts is NOT
restarted automatically if killed.

## Two process lessons recorded this session

- `feedback-never-end-a-turn-to-report-progress.md` — a turn may not end on a
  summary or a statement of intent. Naming the next task is not doing it.
- `feedback-no-force-push-without-explicit-auth.md` — rebasing a branch that is
  already pushed is what forces a force-push. Merge develop in, or
  `git checkout -B <branch> origin/<branch>` and cherry-pick.
