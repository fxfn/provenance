---
name: release
description: >-
  Releases @fxfn/provenance GitHub Action versions with ncc bundle rebuild,
  immutable semver tags, and floating major tags. Use when bumping version,
  cutting a release, tagging v1/v1.x.x, or pushing provenance action updates.
---

# Release

Use this skill when releasing `fxfn/provenance` — a TypeScript GitHub Action bundled with ncc. Consumers pin `uses: fxfn/provenance@v1` (floating major) or a specific `v1.x.x` tag.

## Pre-release checklist

- [ ] Changes under `src/` are complete
- [ ] `npm run lint` passes (`tsc --noEmit`)
- [ ] `package.json` `version` bumped to the target semver (e.g. `1.0.2`)
- [ ] `npm run build` run after the version bump
- [ ] `dist/` diff matches source changes (runner executes committed bundle, not `src/`)

## What to commit

Always include rebuilt artifacts with release changes:

```bash
git add dist/ src/ action.yml package.json
```

Only add `action.yml` or `package.json` when they changed for this release.

## Commit message

Use [Conventional Commits](https://www.conventionalcommits.org/) **without a scope**. Describe what changed — do **not** use `Release vX.Y.Z` as the commit subject.

| Semver bump | Typical type |
|-------------|--------------|
| patch (fix) | `fix` |
| minor (feature) | `feat` |
| docs-only | `docs` |
| tooling / version bump only | `chore` |

The release version lives in `package.json` and git tags — not in the commit subject.

### Ask the user to choose a commit message

**Do not commit until the user selects or enters a message.**

1. Run `git diff` (and `git diff --cached` if anything is already staged) to understand what changed.
2. Draft **2–3 semantic commit messages** that accurately describe the release (vary wording or emphasis if useful).
3. Use the **AskQuestion** tool to present those options plus **Other** for a custom message.

Example AskQuestion setup:

```text
Question id: commit-message
Prompt: Which commit message should be used for this release?

Options (use the full message as each option label):
  - fix: condense job summary into single build details table
  - fix: remove deploykit links and simplify job summary layout
  - chore: rebuild dist for v1.0.2
  - Other
```

4. **Wait for the user's answer** before running `git commit`.
5. If the user picks a predefined option, commit with that exact string.
6. If the user picks **Other**, ask them to provide their message (or use a follow-up AskQuestion / chat reply), then commit with what they supply.
7. If none of the drafts fit, revise the options and ask again — do not commit yet.

## Tag convention

Every release needs **two** tags on the same commit:

| Tag | Purpose |
|-----|---------|
| `vX.Y.Z` | Immutable — never move or force-push |
| `vX` | Floating major — force-update on each release in that major line |

Example for `1.0.2`: create `v1.0.2`, then `git tag -f v1`.

If `vX.Y.Z` already exists on a different commit, **stop** and tell the user — do not move immutable tags.

## Release workflow

Replace `X.Y.Z` with the target version (`package.json` has no `v` prefix; git tags include `v`).

```bash
# 1. Bump version in package.json, then rebuild
npm run lint
npm run build

# 2. Stage changes
git add dist/ src/ action.yml package.json

# 3. Ask user to choose commit message (AskQuestion) — do not commit yet

# 4. Commit with the user's chosen message
git commit -m "$(cat <<'EOF'
<user-selected message>
EOF
)"

# 5. Tag (create or update floating major only)
git tag -a vX.Y.Z -m "vX.Y.Z"    # skip if tag already exists on this commit
git tag -f vX

# 6. Push commit and tags
git push origin main
git push origin vX.Y.Z           # omit if that immutable tag was already pushed
git push -f origin vX            # always force-push the floating major tag
```

After the user selects a commit message, run steps 4–6 without asking again unless push fails.

## Git safety

- **Never** force-push `main` or `master`
- **Only** force-push the floating major tag (`v1`, `v2`, …)
- Do not commit until the user selects or enters a commit message
- Do not skip hooks (`--no-verify`) unless the user explicitly requests it

## Verify after push

```bash
git status                    # clean working tree
git log -1 --oneline          # matches user-selected commit message
git show vX --no-patch        # floating tag points at release commit
git tag -l 'v*'               # vX.Y.Z and vX both exist
```

## Constraints

- Node.js 24+ for local build (action runs on `node24`)
- Do **not** upgrade `@actions/core` past 2.x or `@actions/github` past 6.x — ESM-only majors break ncc CommonJS bundling
- Repository must be **public** for use from other public repos

## User-facing result

After release, consumers on the major line pick up the new build automatically:

```yaml
uses: fxfn/provenance@v1
```

Pin to an exact version when needed:

```yaml
uses: fxfn/provenance@v1.0.2
```
