// src/index.js
const core   = require('@actions/core');
const github = require('@actions/github');
const fetch  = require('node-fetch');

async function run() {
  try {
    // 1️⃣ Inputs & context
    const apiUrl = core.getInput('api-url', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const token  = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;
    if (!pr) throw new Error('Must run on pull_request');
    const commit = pr.head.sha;

    core.info(`🔍 Looking up any non-completed check on ${commit}`);

    // 2️⃣ PHASE 1: find the first check run that isn’t completed
    const maxPhase1 = 10, pause = 2000;
    let checkRunId;
    for (let i = 1; i <= maxPhase1; i++) {
      core.info(`Phase 1 [${i}/${maxPhase1}]: list all checks`);
      const { data } = await octokit.rest.checks.listForRef({
        owner, repo, ref: commit
      });
      // debug:
//      data.check_runs.forEach(r =>
//        core.debug(` • ${r.name} [${r.status}] id=${r.id}`)
//      );
      const run = data.check_runs.find(r => r.status !== 'completed');
      if (run) {
        checkRunId = run.id;
        core.info(`→ Found check run #${checkRunId} (${run.name} / ${run.status})`);
        break;
      }
      await new Promise(r => setTimeout(r, pause));
    }
    if (!checkRunId) {
      throw new Error(`Timed out waiting for your job’s check run to appear on ${commit}`);
    }

    // 3️⃣ Grab the diff & prompt
    core.info('📄 Fetching PR diff + prompt…');
    const diffResp = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: pr.number, mediaType: { format: 'diff' } }
    );
    const diff = diffResp.data;
    const prompt = pr.body || '';

    // 4️⃣ Kick off your Marshal API
    core.info(`🚀 Firing Marshal for check #${checkRunId}…`);
    const branch = 'main'
    const payload = { owner, repo, commit, diff, prompt, checkRunId, branch };
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
    core.info('✅ Marshal kicked off successfully');

    // 5️⃣ PHASE 2: wait for that same run to complete
    const maxPhase2 = 30;
    let final;
    for (let i = 1; i <= maxPhase2; i++) {
      core.info(`Phase 2 [${i}/${maxPhase2}]: polling check #${checkRunId}`);
      const { data: run } = await octokit.rest.checks.get({
        owner, repo, check_run_id: checkRunId
      });
      if (run.status === 'completed') {
        final = run;
        core.info(`→ Check #${checkRunId} completed (${run.conclusion})`);
        break;
      }
      await new Promise(r => setTimeout(r, pause));
    }
    if (!final) {
      throw new Error(`Timed out waiting for check #${checkRunId} to complete`);
    }

    // 6️⃣ Conclude
    if (final.conclusion !== 'success') {
      core.setFailed(
        `🚨 Marshal FAILED (${final.conclusion})\n\n` +
        `**${final.output.title}**\n${final.output.summary}\n\n${final.output.text}`
      );
    } else {
      core.info(`🎉 Marshal PASSED: ${final.output.summary}`);
    }

  } catch (err) {
    core.setFailed(err.message);
  }
}

run();
