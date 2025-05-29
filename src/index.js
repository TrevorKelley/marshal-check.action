// src/index.js
const core   = require('@actions/core');
const github = require('@actions/github');
const fetch  = require('node-fetch');

async function run() {
  try {
    // 1️⃣ Inputs & context
    const apiUrl = core.getInput('api-url',    { required: true });
    const apiKey = core.getInput('api-key',    { required: true });
    const token  = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;
    if (!pr) throw new Error('This action must run on pull_request events');
    const commit   = pr.head.sha;
    const checkName = github.context.workflow; // your workflow's top-level `name:`

    core.info(`🔍 Looking for check run "${checkName}" on SHA ${commit}`);

    // 2️⃣ PHASE 1: locate the job's own check run (queued or in_progress)
    const maxPhase1 = 10, pause = 2000;
    let checkRunId;
    for (let i = 1; i <= maxPhase1; i++) {
      core.info(`Phase1: listing all check runs (attempt ${i}/${maxPhase1})`);
      const { data } = await octokit.rest.checks.listForRef({
        owner, repo, ref: commit
      });
      // debug log all names/statuses
      data.check_runs.forEach(r =>
        core.debug(`  • ${r.name} [${r.status}] → id=${r.id}`)
      );
      // find the first run with our name not yet completed
      const run = data.check_runs.find(r =>
        r.name === checkName && r.status !== 'completed'
      );
      if (run) {
        checkRunId = run.id;
        core.info(`✅ Found check run id=${checkRunId} status=${run.status}`);
        break;
      }
      await new Promise(r => setTimeout(r, pause));
    }
    if (!checkRunId) {
      throw new Error(`Timed out locating check run "${checkName}"`);
    }

    // 3️⃣ Gather diff & prompt
    const diffResp = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner, repo,
        pull_number: pr.number,
        mediaType: { format: 'diff' }
      }
    );
    const diff   = diffResp.data;
    const prompt = pr.body || '';

    // 4️⃣ Kick off Marshal
    core.info(`🚀 Firing Marshal for run #${checkRunId}…`);
    const payload = { owner, repo, commit, diff, prompt, checkRunId };
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
    if (res.status !== 202) {
      const txt = await res.text();
      throw new Error(`Marshal API error ${res.status}: ${txt}`);
    }
    core.info('✅ Marshal validation kicked off');

    // 5️⃣ PHASE 2: wait for that check to complete
    const maxPhase2 = 30;
    let finalConclusion, finalOutput;
    for (let i = 1; i <= maxPhase2; i++) {
      core.info(`Phase2: polling check #${checkRunId} (attempt ${i}/${maxPhase2})`);
      const { data: run } = await octokit.rest.checks.get({
        owner, repo,
        check_run_id: checkRunId
      });
      if (run.status === 'completed') {
        finalConclusion = run.conclusion;
        finalOutput     = run.output;
        core.info(`✅ Check #${checkRunId} completed (${finalConclusion})`);
        break;
      }
      await new Promise(r => setTimeout(r, pause));
    }
    if (!finalConclusion) {
      throw new Error(`Timed out waiting for check #${checkRunId} to complete`);
    }

    // 6️⃣ Final result
    if (finalConclusion !== 'success') {
      core.setFailed(
        `🚨 Marshal validation FAILED (${finalConclusion})\n\n` +
        `**${finalOutput.title}**\n${finalOutput.summary}\n\n${finalOutput.text}`
      );
    } else {
      core.info(`🎉 Marshal validation PASSED: ${finalOutput.summary}`);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
