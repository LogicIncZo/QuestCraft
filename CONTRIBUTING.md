# Contributing to QuestCraft

## 🐛 Report Bugs

Open a [GitHub Issue](https://github.com/CCAgentOrg/QuestCraft/issues/new) with:

- Browser + OS
- Steps to reproduce
- Expected vs actual behavior
- Screenshots (if applicable)

## 💡 Feature Requests

Open an issue with the `enhancement` label. Describe what you want, why, and (optionally) how you'd implement it.

## 🧑‍💻 Code Contributions

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make changes
4. Run `npm run build` to verify it compiles
5. Commit with clear messages
6. Push and open a PR against `main`

### Style

- TypeScript with types in `types.ts`
- Indent: 4 spaces
- Components in `components/`, services in `services/`
- Use `useCallback` + `useEffect` patterns from existing components

## ✅ PR Checklist

- [ ] Build passes (`npm run build`)
- [ ] No new TypeScript errors
- [ ] Tested on mobile + desktop viewport
- [ ] Added to locale files if introducing new UI strings

## 🚦 Verification Gates & Auto-Promotion (`dev` → `main`)

Feature work lands on `dev`; `main` is only ever advanced through the automated
promotion flow. Two GitHub Actions workflows enforce this:

**`CI`** (`.github/workflows/ci.yml`) — runs on every push to `dev`/`main` and
every PR targeting `main`:

| Gate | What it runs |
| --- | --- |
| `build` | `typecheck`, `lint`, unit tests (`npm test`), production build |
| `e2e` | agent-browser suite against the production preview |
| `security-audit` | `npm audit --audit-level high` (advisory) |
| `verification-gate` | Aggregate check: fails if any of the above fail |

**`Promote dev to main`** (`.github/workflows/promote-to-main.yml`) — runs on
every push to `dev` (and manually via *Run workflow*):

1. Re-runs the full gate suite on `dev`.
2. If `dev` is ahead of `main`, opens or reuses a "Promote dev to main" PR.
3. Enables auto-merge on that PR, so it merges once all required checks pass.

To promote manually: **Actions → Promote dev to main → Run workflow**.

### Making the gates required (recommended)

Branch protection makes the gates enforceable so a failed check can never
reach `main`. In *Settings → Rules → Rulesets → New branch ruleset* for
`main`, enable "Require a pull request before merging" and "Require status
checks to pass", selecting **`CI / verification-gate`** as the required check.
Or via the API (repo admin):

```bash
gh api repos/LogicIncZo/QuestCraft/rulesets -X POST --input - <<'EOF'
{
    "name": "protect-main",
    "target": "branch",
    "enforcement": "active",
    "conditions": {
        "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
    },
    "rules": [
        {
            "type": "pull_request",
            "parameters": {
                "required_approving_review_count": 0,
                "dismiss_stale_reviews_on_push": false,
                "require_code_owner_review": false,
                "require_last_push_approval": false,
                "allowed_merge_methods": ["merge", "squash", "rebase"]
            }
        },
        {
            "type": "required_status_checks",
            "parameters": {
                "strict_required_status_checks_policy": false,
                "required_status_checks": [
                    { "context": "CI / verification-gate" }
                ]
            }
        }
    ]
}
EOF
```

Note: before auto-merge can complete, "Allow auto-merge" must be enabled in
*Settings → General → Pull Requests*.
