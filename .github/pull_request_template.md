## Summary
<!-- What changed and why -->

## Test plan
<!-- How to verify this works -->

## Pre-merge gate (SHY-0127)
<!-- Run `scripts/pre-merge-check.sh <PR#>` before judgment-merge — it refuses unless these are satisfied. -->
- [ ] Story flipped to **In Review** (the CI **Pre-Merge Gate** check enforces this)
- [ ] Re-reviewed since the last code-review — `Reviewed-up-to: <sha>` in the story `## Notes` is current
- [ ] Definition of Done met
- [ ] Dev-verified on real devices, or N/A: <reason>
- [ ] Backend change? the FULL app + web + device gauntlet ran (CI forces the full matrix on `backend_changed`)

---

<details>
<summary>Manual Workflows (Actions tab → workflow_dispatch)</summary>

| Workflow | Description |
|----------|-------------|
| **Deploy to Dev** | Deploy backend/web to dev, distribute APK/IPA to testers |
| **E2E Tests** | Run full E2E matrix (Android, iOS, Web device/browser filters) |
| **Deploy to Production** | Deploy a release tag to production |
| **Force Cancel All Runs** | Cancel all active workflow runs |

</details>
