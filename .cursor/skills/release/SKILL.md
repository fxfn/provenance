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

Examples:

```
fix: remove deploykit links from job summary
feat: add environment input to provenance payload
chore: bump version to 1.0.2
```

The release version lives in `package.json` and git tags — not in the commit subject.

### Approve before committing

**Do not commit until the user approves the message.**

1. Run `git diff` (and `git diff --cached` if anything is already staged) to understand what changed.
2. Draft a semantic commit subject (and optional body) that summarizes the release changes.
3. Present the proposed message to the user and ask for confirmation, for example:

   > Proposed commit message:
   >
   > ```
   > fix: condense job summary into single build details table
   > ```
   >
   > OK to commit with this message, or would you like to change it?

4. **Wait for the user's response** before running `git commit`.
5. If the user approves, commit with the proposed message.
6. If the user provides a different message, use their message instead.
7. If the user rejects without a replacement, revise the draft and ask again — do not commit yet.

Only proceed to tagging and pushing after the commit succeeds and the user has asked to push (if applicable).

## Tag convention

Every release needs **two** tags on the same commit:

| Tag | Purpose |
|-----|---------|
| `vX.Y.Z` | Immutable — never move or force-push |
| `vX` | Floating major — force-update on each release in that major line |

Example for `1.0.2`: create `v1.0.2`, then `git tag -f v1`.

## Release workflow

Replace `X.Y.Z` with the target version (without the `v` prefix in `package.json`; with `v` in git tags).

```bash
# 1. Bump version in package.json, then rebuild
npm run lint
npm run build

# 2. Stage changes
git add dist/ src/ action.yml package.json

# 3. Draft commit message from the diff, present to user, and wait for approval
#    (see "Approve before committing" above — do not run git commit yet)

git commit -m "$(cat <<'EOF'
<user-approved message>
EOF
)"

# 4. Tag
git tag -a vX.Y.Z -m "vX.Y.Z"
git tag -f vX

# 5. Push (only when the user explicitly asks to push)
git push origin main
git push origin vX.Y.Z
git push -f origin vX
```

## Git safety

- **Never** force-push `main` or `master`
- **Only** force-push the floating major tag (`v1`, `v2`, …)
- Do not create the release commit until the user approves the commit message
- Do not push unless the user asked
- Do not skip hooks (`--no-verify`) unless the user explicitly requests it

## Verify after push

```bash
git status                    # clean working tree
git log -1 --oneline          # semantic commit subject
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
