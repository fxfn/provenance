import * as core from "@actions/core";
import * as github from "@actions/github";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProvenancePayload {
	// Image identity
	image: string;
	digests: string[];
	tags: string[];

	// Git context
	commit: string;
	branch: string;
	ref: string;
	repo: string;
	repoVisibility: string;

	// Workflow context
	workflowName: string;
	workflowRef: string;
	runId: string;
	runNumber: number;
	runAttempt: number;
	triggeredBy: string;
	triggerEvent: string;
	prNumber: number | null;

	// Environment
	environment: string;
	runnerOs: string;

	// Timing
	recordedAt: string;
}

interface ProvenanceResponse {
	id: string;
}

type SummaryState =
	| {
			status: "success";
			provenanceId: string;
			payload: ProvenancePayload;
			apiUrl: string;
	  }
	| { status: "warning"; reason: string; payload: ProvenancePayload | null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a multiline or comma-separated string into a deduplicated array of
 * non-empty trimmed strings. Handles the output formats of both
 * docker/build-push-action (single digest) and docker/metadata-action (tags).
 */
function parseList(raw: string): string[] {
	return [
		...new Set(
			raw
				.split(/[\n,]+/)
				.map((s) => s.trim())
				.filter(Boolean),
		),
	];
}

/**
 * Exchange the GitHub Actions OIDC token for a short-lived JWT scoped to
 * DeployKit. The audience must match what the DeployKit API expects.
 */
async function getOidcToken(audience: string): Promise<string> {
	const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
	const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

	if (!requestUrl || !requestToken) {
		throw new Error(
			"OIDC token environment variables are not set. " +
				"Ensure the job has `permissions: id-token: write`.",
		);
	}

	const url = `${requestUrl}&audience=${encodeURIComponent(audience)}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${requestToken}` },
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to fetch OIDC token (${response.status}): ${body}`);
	}

	const json = (await response.json()) as { value: string };
	return json.value;
}

/**
 * Post provenance payload to the DeployKit API, authenticated with an OIDC
 * token. Returns the created provenance record ID.
 */
async function recordProvenance(
	apiUrl: string,
	token: string,
	payload: ProvenancePayload,
): Promise<string> {
	const response = await fetch(`${apiUrl}/api/provenance`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`DeployKit API error (${response.status}): ${body}`);
	}

	const json = (await response.json()) as ProvenanceResponse;
	return json.id;
}

/**
 * Write a GitHub Actions job summary reflecting the outcome of the provenance
 * record attempt.
 */
async function writeSummary(state: SummaryState): Promise<void> {
	if (state.status === "warning") {
		await core.summary
			.addHeading("⚠️ DeployKit — Provenance Not Recorded", 2)
			.addRaw(
				`> **Warning:** Provenance was not recorded. This is a non-fatal error and your build has not been affected.\n\n` +
					`**Reason:** ${state.reason}`,
			)
			.addEOL()
			.write();
		return;
	}

	const { provenanceId, payload, apiUrl } = state;
	const shortCommit = payload.commit.slice(0, 7);
	const repoUrl = `https://github.com/${payload.repo}`;
	const commitUrl = `${repoUrl}/commit/${payload.commit}`;
	const runUrl = `${repoUrl}/actions/runs/${payload.runId}`;
	const provenanceUrl = `${apiUrl}/provenance/${provenanceId}`;

	const digestRows = payload.digests.map((d) => [
		`<code>${d}</code>`,
		`<a href="${provenanceUrl}">View in DeployKit →</a>`,
	]);

	const tagRows =
		payload.tags.length > 0
			? payload.tags.map((t) => [`<code>${t}</code>`])
			: [["<em>none</em>"]];

	await core.summary
		.addHeading("✅ DeployKit — Provenance Recorded", 2)
		.addRaw(
			`Provenance for **${payload.image}** has been recorded in [DeployKit](${provenanceUrl}).`,
		)
		.addEOL()
		.addHeading("Image", 3)
		.addTable([
			[
				{ data: "Field", header: true },
				{ data: "Value", header: true },
			],
			["Image", `<code>${payload.image}</code>`],
			["Environment", payload.environment || "<em>not set</em>"],
		])
		.addHeading("Digests", 3)
		.addTable([
			[
				{ data: "Digest", header: true },
				{ data: "DeployKit", header: true },
			],
			...digestRows,
		])
		.addHeading("Tags", 3)
		.addTable([[{ data: "Tag", header: true }], ...tagRows])
		.addHeading("Build context", 3)
		.addTable([
			[
				{ data: "Field", header: true },
				{ data: "Value", header: true },
			],
			["Commit", `<a href="${commitUrl}"><code>${shortCommit}</code></a>`],
			["Branch", `<code>${payload.branch}</code>`],
			["Triggered by", `<code>${payload.triggeredBy}</code>`],
			["Event", `<code>${payload.triggerEvent}</code>`],
			...(payload.prNumber
				? [
						[
							"PR",
							`<a href="${repoUrl}/pull/${payload.prNumber}">#${payload.prNumber}</a>`,
						],
					]
				: []),
			[
				"Run",
				`<a href="${runUrl}">#${payload.runNumber} (attempt ${payload.runAttempt})</a>`,
			],
			["Runner OS", payload.runnerOs],
			["Workflow", `<code>${payload.workflowName}</code>`],
			["Recorded at", payload.recordedAt],
		])
		.write();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
	const ctx = github.context;

	// -- Inputs ----------------------------------------------------------------

	const rawDigests = core.getInput("digests", { required: true });
	const image = core.getInput("image", { required: true });
	const rawTags = core.getInput("tags");
	const environment = core.getInput("environment");
	const apiUrl = core.getInput("api-url").replace(/\/$/, "");
	const writeSummaryEnabled = core.getBooleanInput("write-summary");
	const failOnError = core.getBooleanInput("fail-on-error");

	const digests = parseList(rawDigests);
	const tags = parseList(rawTags);

	// Validate inputs early — these are hard failures before we even try the API.
	if (digests.length === 0) {
		core.setFailed("No digests provided — nothing to record.");
		return;
	}

	// -- Build payload ---------------------------------------------------------

	const prNumber: number | null =
		ctx.eventName === "pull_request"
			? (ctx.payload.pull_request?.number ?? null)
			: null;

	const branch =
		ctx.eventName === "pull_request"
			? (ctx.payload.pull_request?.head?.ref ?? "")
			: ctx.ref.replace(/^refs\/heads\//, "");

	const payload: ProvenancePayload = {
		// Image identity
		image,
		digests,
		tags,

		// Git context
		commit: ctx.sha,
		branch,
		ref: ctx.ref,
		repo:
			ctx.payload.repository?.full_name ?? `${ctx.repo.owner}/${ctx.repo.repo}`,
		repoVisibility: ctx.payload.repository?.visibility ?? "unknown",

		// Workflow context
		workflowName: ctx.workflow,
		workflowRef: process.env.GITHUB_WORKFLOW_REF ?? "",
		runId: String(ctx.runId),
		runNumber: ctx.runNumber,
		runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
		triggeredBy: ctx.actor,
		triggerEvent: ctx.eventName,
		prNumber,

		// Environment
		environment,
		runnerOs: process.env.RUNNER_OS ?? "unknown",

		// Timing
		recordedAt: new Date().toISOString(),
	};

	core.info(`Recording provenance for ${digests.length} digest(s) on ${image}`);
	digests.forEach((d) => {
		core.info(`  • ${d}`);
	});

	// -- OIDC + API (soft-fail) ------------------------------------------------

	try {
		core.info("Requesting OIDC token…");
		const token = await getOidcToken("deploykit.io");

		core.info(`Sending provenance to ${apiUrl}…`);
		const provenanceId = await recordProvenance(apiUrl, token, payload);

		core.setOutput("provenance-id", provenanceId);
		core.info(`✓ Provenance recorded: ${provenanceId}`);

		if (writeSummaryEnabled) {
			await writeSummary({ status: "success", provenanceId, payload, apiUrl });
		}
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);

		if (writeSummaryEnabled) {
			await writeSummary({ status: "warning", reason, payload });
		}

		if (failOnError) {
			core.setFailed(`DeployKit provenance recording failed: ${reason}`);
		} else {
			core.warning(
				`DeployKit provenance recording failed — build will continue.\n${reason}`,
			);
		}
	}
}

run();
