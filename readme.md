# DeployKit — Record Provenance Action

A GitHub Action that records container image build provenance to [DeployKit](https://deploykit.io), linking image digests to the GitHub commit, workflow run, and build context that produced them.

Authentication uses GitHub Actions [OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) — no secrets, tokens, or pre-shared credentials to manage. The action mints a short-lived OIDC token scoped to DeployKit, and the DeployKit API verifies it against GitHub's JWKS before trusting the payload.

## Usage

```yaml
- name: Build and push
  id: push
  uses: docker/build-push-action@v6
  with:
    push: true
    tags: ${{ steps.meta.outputs.tags }}

- name: Record provenance
  uses: fxfn/provenance@v1
  with:
    image: ghcr.io/${{ github.repository }}
    digests: ${{ steps.push.outputs.digest }}
    tags: ${{ steps.meta.outputs.tags }}
    environment: production
```

The job must grant the OIDC permission:

```yaml
permissions:
  id-token: write   # required — lets the action mint an OIDC token
  contents: read
  packages: write   # only if you are also pushing to GHCR in the same job
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `digests` | yes | — | Image digest(s). Accepts the `digest` output of `docker/build-push-action`, or a newline/comma-separated list for multi-platform builds. |
| `image` | yes | — | Fully qualified image name (e.g. `ghcr.io/org/app`). |
| `tags` | no | `''` | Image tags. Accepts the `tags` output of `docker/metadata-action` (newline-separated). |
| `environment` | no | `''` | Target deployment environment (e.g. `production`, `staging`). Used to scope records in DeployKit. |
| `api-url` | no | `https://deploykit.io` | DeployKit API base URL. Override for self-hosted or local development. |
| `write-summary` | no | `true` | Write a job summary with the recorded provenance details. |
| `fail-on-error` | no | `false` | Fail the build if provenance recording fails. Leave `false` for soft-fail (a DeployKit outage won't block your deploy); set `true` for compliance-gated deployments where provenance is mandatory. |

## Outputs

| Output | Description |
|--------|-------------|
| `provenance-id` | The ID of the created provenance record in DeployKit. |

## Failure behaviour

By default the action **soft-fails**: if the OIDC exchange or the DeployKit API call fails, it emits a warning annotation and exits `0` so your build is unaffected. Set `fail-on-error: true` to make provenance recording mandatory — the action will then emit an error annotation and exit non-zero on failure. In both cases the job summary (when enabled) records the outcome and the reason.

## API contract

This documents the endpoint the action calls, for anyone implementing the DeployKit ingestion API. The action sends a single `POST` and only strictly reads `id` from the response; everything else below is recommended for a complete, secure implementation.

### Request

```http
POST /api/provenance HTTP/1.1
Host: deploykit.io
Content-Type: application/json
Authorization: Bearer <github-oidc-jwt>
```

```json
{
  "image": "ghcr.io/deploykit/demo",
  "digests": [
    "sha256:aaa111...",
    "sha256:bbb222..."
  ],
  "tags": [
    "ghcr.io/deploykit/demo:latest",
    "ghcr.io/deploykit/demo:v1.2.3"
  ],
  "commit": "deadbeefcafe1234567890abcdef",
  "branch": "main",
  "ref": "refs/heads/main",
  "repo": "deploykit/demo",
  "repoVisibility": "private",
  "workflowName": "Build and Push",
  "workflowRef": "deploykit/demo/.github/workflows/build.yml@refs/heads/main",
  "runId": "987654",
  "runNumber": 42,
  "runAttempt": 1,
  "triggeredBy": "octocat",
  "triggerEvent": "push",
  "prNumber": null,
  "environment": "production",
  "runnerOs": "Linux",
  "recordedAt": "2026-06-29T04:26:42.923Z"
}
```

### Verify the OIDC token — do not trust the request body

The request body is fully attacker-controllable; anyone can POST JSON to the endpoint. The **only** thing that establishes trust is the OIDC JWT in the `Authorization` header. The API must:

1. Fetch GitHub's public keys from `https://token.actions.githubusercontent.com/.well-known/jwks` (and cache them).
2. Verify the JWT signature, `iss` (`https://token.actions.githubusercontent.com`), `aud` (`deploykit.io`), and expiry.
3. Cross-check the body against the signed claims and reject on mismatch.

The decoded JWT claims look like this:

```json
{
  "iss": "https://token.actions.githubusercontent.com",
  "aud": "deploykit.io",
  "repository": "deploykit/demo",
  "repository_id": "123456789",
  "repository_owner": "deploykit",
  "repository_owner_id": "987654",
  "sha": "deadbeefcafe1234567890abcdef",
  "ref": "refs/heads/main",
  "workflow_ref": "deploykit/demo/.github/workflows/build.yml@refs/heads/main",
  "run_id": "987654",
  "run_attempt": "1",
  "actor": "octocat",
  "event_name": "push",
  "exp": 1782634002,
  "iat": 1782633702
}
```

Treat the JWT claims as authoritative for identity. The body fields `repo`, `commit`, `ref`, `workflowRef`, and `runId` should be ignored in favour of the corresponding claims (or required to match exactly). The fields that have no claim equivalent — `image`, `digests`, `tags`, `environment` — describe the artifact rather than the identity and cannot be cryptographically verified; that is expected. Prefer `repository_id` over `repository` as the tenant key, since repositories can be renamed.

### Success response

`201 Created`

```json
{
  "id": "prov_01J9Z3K7X8QweRtY",
  "image": "ghcr.io/deploykit/demo",
  "digests": [
    "sha256:aaa111...",
    "sha256:bbb222..."
  ],
  "commit": "deadbeefcafe1234567890abcdef",
  "environment": "production",
  "url": "https://deploykit.io/deploykit/demo/provenance/prov_01J9Z3K7X8QweRtY",
  "createdAt": "2026-06-29T04:26:43.110Z"
}
```

The action requires only `id`. Returning `url` lets the job summary deep-link to the canonical DeployKit record rather than constructing a link itself.

### Error responses

Auth failure — `401 Unauthorized`:

```json
{
  "error": "invalid_token",
  "message": "OIDC token audience mismatch: expected 'deploykit.io'"
}
```

Body/claim mismatch — `403 Forbidden`:

```json
{
  "error": "claim_mismatch",
  "message": "Body commit does not match OIDC 'sha' claim"
}
```

Validation failure — `422 Unprocessable Entity`:

```json
{
  "error": "validation_failed",
  "message": "At least one digest is required",
  "fields": {
    "digests": "must be a non-empty array of sha256 digests"
  }
}
```

Repository not onboarded — `404 Not Found`:

```json
{
  "error": "repository_not_registered",
  "message": "deploykit/demo is not connected to a DeployKit account"
}
```

### Idempotency

The same `(repository_id, digest)` pair may be submitted more than once — for example on a workflow re-run with `runAttempt: 2`. Making the endpoint idempotent (return `200` with the existing record on a duplicate, rather than `201` and a second row) keeps the provenance table clean and makes the action safe to retry. The `runAttempt` field lets you distinguish a re-run from a fresh build if you would rather store both.

## Development

### Prerequisites

- Node.js 24+ (the action runs on the `node24` runner)
- npm

### Install

```bash
npm install
```

### Type-check

```bash
npm run lint    # tsc --noEmit
```

### Build

This action is written in TypeScript and bundled into a single file with [`@vercel/ncc`](https://github.com/vercel/ncc). The bundled output in `dist/` is what actually runs — `node_modules` is **not** committed.

```bash
npm run build
```

This compiles `src/index.ts` and all dependencies into `dist/index.js` (plus a source map and license file). **You must rebuild and commit `dist/` whenever you change anything under `src/`** — the runner executes the committed bundle, not your source.

## Dependency versions — important

`@actions/core` and `@actions/github` are intentionally pinned to their **last CommonJS-compatible majors**:

```json
"@actions/core": "^2.0.3",
"@actions/github": "^6.0.1"
```

Do **not** upgrade these to `@actions/core@3.x` or `@actions/github@9.x`. Those releases switched to **ESM-only** packages (their `package.json` `exports` field only declares an `import` condition, with no `require`). ncc bundles to CommonJS, so building against the ESM-only versions fails with:

```
Error: Package path . is not exported from package .../@actions/core
```

Until ncc gains first-class ESM output support, the v2 / v6 lines are the correct, stable choice. If you ever need to move to the ESM-only versions, you would have to switch the build toolchain to an ESM-aware bundler (e.g. `esbuild` with `--format=esm`) and set `"type": "module"`.

## Release

Users reference the action by tag, so every release needs at least one tag. The convention is an immutable version tag plus a floating major tag that points at the latest release in that major line.

1. Rebuild the bundle and commit it alongside your changes:

   ```bash
   npm run build
   git add dist/ src/ action.yml package.json
   git commit -m "Release v1.2.3"
   ```

2. Create the immutable version tag and move the floating major tag:

   ```bash
   git tag -a v1.2.3 -m "v1.2.3"
   git tag -f v1            # floating major — users on @v1 get this release
   ```

3. Push the commit and tags:

   ```bash
   git push origin main
   git push origin v1.2.3
   git push -f origin v1    # force-update the floating major tag
   ```

Users then pin to the major line and automatically receive patch and minor updates:

```yaml
uses: fxfn/provenance@v1
```

> **Note:** The repository must be **public** to be usable from other public repositories. Private repositories can only use the action from within the same repository or organisation (depending on your Actions sharing settings).

## Keeping `dist/` honest

Because the bundle is committed by hand, it's easy to edit `src/` and forget to rebuild before tagging. A CI check that rebuilds and diffs `dist/` against the committed version catches this — recommended as a required status check on pull requests.