---
id: SHY-0050
status: Draft
owner: claude
created: 2026-06-08
priority: P2
effort: XS
type: docs
roadmap_ids: [G032]
pr:
---

# SHY-0050: Add rationale comment to `biometric = "1.4.0-alpha07"` in libs.versions.toml

## User Story

As a future ShyTalk maintainer reading `gradle/libs.versions.toml`, I want **`biometric = "1.4.0-alpha07"` to carry an inline rationale comment** naming the API(s) we use that aren't in the stable line (1.1.0), so that the alpha-version dependency isn't mysterious + isn't accidentally downgraded.

## Why

Roadmap row (line 108, 2026-06-05): `G032 | 🟡 Polish | Dep — biometric alpha rationale comment | gradle/libs.versions.toml:33 | (companion to G002) | Same fix as G002, polish portion | XS`.

The G002 part (downgrade if stable covers, else add comment) was covered by [[SHY-0005]] biometric-alpha-to-stable. G032 is specifically the COMMENT side — even if [[SHY-0005]] downgrades, this SHY's deliverable is to document the rationale comment as a pattern other "alpha-pinned" lines can follow.

This is essentially a documentation polish: if [[SHY-0005]] downgrades, then this SHY converts to a meta-doc about the pattern; if [[SHY-0005]] keeps alpha + adds the comment, this SHY may already be redundant.

## Acceptance Criteria

### Happy path

- [ ] **Path A** (if [[SHY-0005]] downgraded to 1.1.0 stable): no comment needed; this SHY becomes a no-op + closes as `Cancelled` with rationale.
- [ ] **Path B** (if [[SHY-0005]] kept alpha07): the comment above the line follows the format `# Required: <API> — <stable-version> doesn't ship <feature> yet; downgrade gated by [[SHY-NNNN]]`.
- [ ] If neither has happened yet (i.e. SHY-0005 still Draft): this SHY blocks on it; mark `Blocked` in frontmatter.

### Error paths

- [ ] **[[SHY-0005]] is implemented but doesn't add a comment**: this SHY adds the comment + cross-links.
- [ ] **The API rationale is no longer accurate** (we removed the alpha-only usage): downgrade in this SHY instead.

### Edge cases

- [ ] **Multiple alpha deps** in libs.versions.toml: out of scope; this SHY only covers biometric.
- [ ] **Comment style consistency** with other libs.versions.toml comments (check existing format).

### Performance

- [ ] N/A.

### Security

- [ ] N/A — comment only.

### UX

- [ ] N/A — maintainer-facing.

### i18n

- [ ] N/A — code comment, English only.

### Observability

- [ ] PR description records the SHY-0005 status at SHY-pickup time; defines path A/B/blocked.

## BDD Scenarios

**Scenario: Comment present after this SHY ships**

- **Given** [[SHY-0005]] kept biometric on alpha07
- **When** the contributor reads `gradle/libs.versions.toml:33`
- **Then** there is a comment block above the line naming the required API + the stable-version gap

**Scenario: Cancelled if downgrade happens first**

- **Given** [[SHY-0005]] downgraded to 1.1.0 stable
- **When** the contributor picks up this SHY
- **Then** the SHY closes as `Cancelled` with rationale "biometric stable; no alpha pinning to explain"

## Test Plan

**Red:** N/A — comment-only change.

**Green:**
- Check SHY-0005's status + libs.versions.toml current state.
- If Path B: add comment.
- If Path A: close as Cancelled.

**Coverage gate:** post-merge `git log -p libs.versions.toml | grep -A 2 biometric` shows the comment OR cancellation Notes.

## Out of Scope

- Downgrading biometric — covered by [[SHY-0005]].
- Adding rationale comments to OTHER alpha-pinned deps (separate SHYs).
- Refactoring libs.versions.toml structure.

## Dependencies

- [[SHY-0005]] (biometric-alpha-to-stable, Draft) — must resolve first to determine path.

## Risks & Mitigations

- **Risk: this SHY is redundant after SHY-0005's PR.** Mitigation: explicit `Cancelled` pathway in AC.
- **Risk: comment goes stale if biometric stable lands.** Mitigation: link to [[SHY-0005]] in the comment so the bump SHY's pickup naturally re-evaluates.

## Definition of Done

- [ ] Path A or Path B applied per SHY-0005's state at pickup time.
- [ ] Reviewer ZERO findings (or `Cancelled` with rationale).
- [ ] `status: Done` or `Cancelled`.

## Notes (running log)

- 2026-06-08 ~13:15 BST — Spec created by SHY-0036 batch fill. Source: zero-gap roadmap line 108 (G032). Reserved ID SHY-0050.
