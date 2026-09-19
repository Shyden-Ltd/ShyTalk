---
id: SHY-0532
status: Draft
owner: unassigned
created: 2026-09-19
priority: P0
effort: L
type: infra
roadmap_ids: []
mvp: false
epic: EPIC-0001
---

# SHY-0532: Agents act on ShyTalk under their own least-privilege GitHub identity

## User Story

As **the operator**, I want agent sessions on my machine to act on ShyTalk
under their own least-privilege GitHub identity instead of my personal login,
so that no agent, however it is steered, can approve a production deployment,
change branch protection, or otherwise act as me.

## Why

- Agents do real GitHub work on this repository every day: they push branches,
  open and merge pull requests, read CI logs and move board cards. Today they
  do it through the operator's personal login, which carries owner rights that
  no agent needs.
- shyden.co.uk made this move under Shyden-Ltd/shyden.co.uk#245. Its agents
  now push, open pull requests, comment and merge as a dedicated GitHub App,
  and that App's attempt to approve a protected deployment was refused with
  HTTP 403. ShyTalk is the flagship, and it has no equivalent control.
- The release protocol already reserves production to the operator. Today
  that is a rule agents follow, not a property GitHub enforces. This story
  makes it a property.
- **The measured detail is private.** Which ShyTalk flows use the operator's
  login today, and the known limits of the current guard, are recorded in the
  draft security advisory GHSA-wgg8-m3wp-rq2m, which only repository admins
  can open. This repository is public, so they are deliberately not repeated
  here.

## Acceptance Criteria

### Happy path

- [ ] **Census before design.** A script, not memory, enumerates every GitHub
      operation that ShyTalk agent sessions perform (`gh`, `git` and direct API
      calls) from the session transcripts, and maps each one to the least
      permission it needs. The script and its output are recorded in the
      private advisory.
- [ ] **The operator chooses the identity.** The options are: install the
      existing `shyden-agent` App on ShyTalk as well, create a separate ShyTalk
      App, or use a machine user. They are compared against the census on
      blast radius, cost (zero-cost by default), key handling and set-up
      effort, with a recommendation. Shyden chooses through AskUserQuestion,
      and his choice is recorded in Notes in his words.
- [ ] Agent `git` and `gh` operations on ShyTalk run as the chosen identity
      through the existing identity router and credential helper, which are
      extended rather than copied, so each concern keeps one home.
- [ ] Every flow the census found works under the new identity. Each is
      proven by a real run on ShyTalk, not by reading configuration.
- [ ] Commits stay authored as Shyden (operator decision, 2026-09-19). The
      identity only pushes and acts; the author of a pushed commit is read
      back to prove it.
- [ ] The release protocol, the agent instructions (CLAUDE.md) and the hooks
      name the ShyTalk identity, so a later session knows which identity acts
      where.

### Error paths

- [ ] Every failure to obtain the identity's credential fails closed, with a
      one-line message that names the cause. That covers a missing key, a
      revoked installation, a refused or expired token and a network failure.
      None of them falls back to the operator's login, and each case is
      produced for real, with its message recorded.
- [ ] An operation the identity is not permitted to perform fails with
      GitHub's own refusal, shown verbatim, followed by a line saying that the
      action is the operator's to take.
- [ ] The identity cannot approve a waiting deployment to a protected
      environment. A probe with its predictions written down first records the
      refusal (HTTP 403 or GitHub's equivalent). As the control, the operator
      approves the same probe from his own terminal.

### Edge cases

- [ ] Background work uses the same identity as foreground commands. That
      covers backgrounded commands, monitor-launched waiters and scheduled
      wake-ups, each proven by a real background run.
- [ ] Calls that target no Shyden-Ltd repository, such as reading a public
      third-party repository to pin an action to a commit SHA, keep working.
      They run under the agent identity or unauthenticated, never under the
      operator's login, and each is proven by a real call.
- [ ] shyden.co.uk's existing route is unchanged. The router's shyden.co.uk
      unit tests and mutation suite stay green. No live action in shyden.co.uk
      is part of this story.
- [ ] Every bypass route recorded in the private advisory is closed for
      ShyTalk, each proven by a real attempt that fails.
- [ ] The operator's own terminal, outside any agent session, keeps his
      GitHub login and git credentials, measured before and after.

### Performance

- [ ] The latency the identity adds is measured and recorded, as the median
      and p95 over at least 20 calls each of an agent `gh` call and a
      `git push`.
- [ ] A burst of calls within one credential's lifetime reuses that
      credential rather than minting one per call. This is measured by
      counting mints.

### Security

- [ ] **Least privilege.** Every permission the identity holds is justified
      by a census entry, and nothing else is granted. The identity has no
      admin rights and cannot approve any environment, edit branch protection
      or rulesets, or manage secrets. Each of those is measured by a refused
      attempt, with predictions written first.
- [ ] **No route back to the operator.** No agent session can reach the
      operator's personal GitHub credential by any route: there is no operator
      fallback in the router or the credential helper, no read of the stored
      login, and no printing of a token. This is measured from inside an agent
      session, where every route is refused, and from the operator's own
      terminal, where everything still works.
- [ ] The guard that stops agents stepping round the router covers every
      repository, not only shyden.co.uk. Its test and mutation suites gain the
      ShyTalk cases, and every new guard is mutation-verified both ways.
- [ ] The identity's private key is readable only by the operator's user
      account and is never printed to a transcript or a log. A key-rotation
      procedure is written down and rehearsed once.
- [ ] Nothing on this repository's public surface carries the measured detail:
      not this story, not a pull-request body, not a workflow file, not a run
      log. The detail stays in the private advisory, and its privacy is
      measured: unauthenticated requests get 404, with the public repository
      page returning 200 as the control.

### UX

- [ ] The operator's day-to-day use of `gh` and `git` in his own terminal is
      unchanged.
- [ ] An agent stopped by the fail-closed path gets one line saying what failed
      and whose action it is. There is no stack trace and no silent retry.
- [ ] GitHub shows agent actions under the chosen identity's name and avatar,
      so on pull requests, the board and the activity feed the operator can
      tell his own actions from an agent's at a glance.

### i18n

- [ ] Unchanged. The work touches developer tooling and GitHub identity only,
      and no user-facing copy changes in any of the five MVP locales. Refusal
      messages are English, like the rest of the repository's tooling output.

### Observability

- [ ] Every agent action on ShyTalk is attributable. GitHub's activity records
      name the chosen identity as the actor for a push, a pull request, a
      comment, a board move and a merge. Each is read back afterwards, never
      inferred from the command's own output.
- [ ] The router records, for each call, the repository, the route and the
      identity it chose (never a token) in a local log, so a wrong route can
      be diagnosed after the fact.

## BDD Scenarios

**Scenario: An agent pushes and opens a pull request as its own identity**

- **Given** an agent session working on a ShyTalk story branch
- **When** it pushes the branch and opens a pull request
- **Then** GitHub records the chosen agent identity as the actor for both
- **And** the pushed commits are still authored as Shyden

**Scenario: An agent cannot approve a production deployment**

- **Given** a deployment waiting on a protected environment
- **When** an agent session tries to approve it
- **Then** GitHub refuses the approval
- **And** the operator can still approve it from his own terminal

**Scenario: A credential failure fails closed**

- **Given** the agent identity's credential cannot be obtained
- **When** an agent session runs a GitHub command against ShyTalk
- **Then** the command fails with one line naming the cause
- **And** nothing is done with the operator's login instead

**Scenario: The operator's own terminal is untouched**

- **Given** the operator working in his own terminal, outside any agent session
- **When** he runs `gh` or pushes with `git`
- **Then** both act as him, exactly as before this story

**Scenario: A bypass attempt is refused**

- **Given** an agent session inside ShyTalk
- **When** it tries any bypass route recorded in the private advisory
- **Then** the attempt is refused and no GitHub action happens as the operator

## Test Plan

- **Unit.** The router's and credential helper's suites gain ShyTalk cases,
  run with real processes and no mocks: the route chosen for ShyTalk, a
  fail-closed result for each credential failure, and no operator fallback
  anywhere.
- **Mutation.** Every new guard is mutation-verified both ways, against the
  existing mutation suites. Each mutation's predicted verdict is written down
  before it runs, and the whole verdict is read, never a filtered line.
- **Live, positive.** Each flow in the census is run for real on ShyTalk under
  the new identity: a push to a throwaway branch, opening and commenting on a
  pull request, a board move and a merge. The actor is read back from GitHub
  after each one.
- **Live, negative.** Each refused capability is attempted for real: approving
  an environment, editing protection, managing secrets and every bypass route
  in the advisory. The predictions go in the advisory before the run and the
  results after it.
- **Probe hygiene.** Probe workflows and their logs are public on this repo.
  A probe therefore reads nothing the public story does not already name, and
  every throwaway environment or branch is deleted afterwards, with the
  deletion read back.
- **Regression.** The shyden.co.uk route's unit and mutation suites stay green.
  The operator's own terminal is measured before and after.

## Out of Scope

- Credentials used inside this repository's GitHub Actions workflows, such as
  the workflow token and repository or environment secrets. Those run on
  GitHub, not in agent sessions.
- shyden.co.uk's identity. It was done under Shyden-Ltd/shyden.co.uk#245 and
  its route must not change here.
- Commit authorship, which stays Shyden.
- The operator's own terminal login, which is kept.
- Any live action in a repository other than ShyTalk.

## Dependencies

- Shyden-Ltd/shyden.co.uk#245 (done 2026-09-19) supplies the identity router,
  the credential helper, token minting and the bypass guard that this story
  extends.
- The operator's choice of identity (see Happy path).
- An operator action to create or install the chosen identity, because only an
  organisation owner can install an App or add an account.

## Risks & Mitigations

- **Removing the operator route breaks a flow mid-release.** The census runs
  first. Every flow is proven under the new identity by a real run before the
  operator route is removed, and that removal is the last step.
- **The operator is locked out of his own terminal.** Both sides are measured,
  and a restore procedure is written down before the removal.
- **One App shared by two repositories widens what a stolen key can reach**
  (if that option is chosen). The option comparison states this, and the key
  handling and the rotation rehearsal apply either way.
- **Detail leaks through this public repository.** The detail lives only in
  the private advisory, and its privacy is measured.
- **A command-text guard cannot see every route a program can take.** The
  control is the credential's absence from agent sessions. The guard is
  defence in depth, not the control.

## Definition of Done

- [ ] Every AC is ticked with linked evidence. Detail stays in the private
      advisory.
- [ ] The unit, mutation and live suites are green, with predictions recorded
      before each run.
- [ ] The story checker passes and the SHY-INDEX row is current.
- [ ] An evidence page is published and Shyden's sign-off is recorded before
      merge.
- [ ] The advisory is updated with the results. Whether it is closed or
      published afterwards is Shyden's decision.

## Notes

- 2026-09-19 14:55 WIB — **Filed** at the operator's request ("File the gh
  login ticket"), as the ShyTalk half of Shyden-Ltd/shyden.co.uk#245. The
  measured detail was moved into the private draft advisory
  GHSA-wgg8-m3wp-rq2m (repository admins only). Its privacy was measured at
  filing: unauthenticated requests to the advisory page and to its API both
  got 404, while the public repository page returned 200.
- **Priority P0** follows the standing rule that any vulnerability is P0. The
  advisory rates the exposure high. Downgrading is the operator's call.
- **Where the work lives.** The router, the credential helper and the guard
  are the operator's machine-level agent configuration, outside this
  repository. Their tests and mutation suites live beside them, as under
  shyden.co.uk#245. The exact paths are in the advisory.
