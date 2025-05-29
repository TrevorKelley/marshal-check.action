// src/index.js
const core   = require('@actions/core');
const github = require('@actions/github');
const fetch  = require('node-fetch');

async function run() {
  try {
    // 1️⃣ Get inputs & context
    const apiUrl = core.getInput('api-url', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const token  = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr   = github.context.payload.pull_request;
    if (!pr) throw new Error('This action must run on pull_request events');
    const commit   = pr.head.sha;
    const checkName = github.context.workflow; // must match your workflow’s name

    // 2️⃣ PHASE 1: wait up to ~20s for GitHub to spin up the in_progress check
    const maxPhase1  = 10;
    const intervalMs = 2000;
    let checkRunId;
    for (let i = 0; i < maxPhase1; i++) {
      core.info(`Phase 1: looking for in_progress '${checkName}' (attempt ${i+1}/${maxPhase1})…`);
      const { data } = await octokit.rest.checks.listForRef({
        owner, repo, ref: commit, check_name: checkName, status: 'in_progress'
      });
      if (data.check_runs.length) {
        checkRunId = data.check_runs[0].id;
        core.info(`→ Found in_progress check run #${checkRunId}`);
        break;
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    if (!checkRunId) {
      throw new Error(`Timed out waiting for in_progress '${checkName}' on ${commit}`);
    }

    // 3️⃣ Gather diff & prompt
    const diffResp = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: pr.number, mediaType: { format: 'diff' } }
    );
    const diff   = diffResp.data;
    const prompt = pr.body || '';

    // 4️⃣ Kick off Marshal via your API
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

    // 5️⃣ PHASE 2: poll the same check until it completes (~60s max)
    const maxPhase2 = 30;
    let finalConclusion, finalOutput;
    for (let i = 0; i < maxPhase2; i++) {
      core.info(`Phase 2: polling #${checkRunId} for completion (attempt ${i+1}/${maxPhase2})…`);
      const { data: run } = await octokit.rest.checks.get({
        owner, repo, check_run_id: checkRunId
      });
      if (run.status === 'completed') {
        finalConclusion = run.conclusion;
        finalOutput     = run.output;
        core.info(`→ Check #${checkRunId} completed (${finalConclusion})`);
        break;
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    if (!finalConclusion) {
      throw new Error(`Timed out waiting for check #${checkRunId} to complete`);
    }

    // 6️⃣ Final pass/fail
    if (finalConclusion !== 'success') {
      core.setFailed(
        `🚨 Marshal check failed (${finalConclusion})\n\n` +
        `**${finalOutput.title}**\n${finalOutput.summary}\n\n${finalOutput.text}`
      );
    } else {
      core.info(`✅ Marshal passed: ${finalOutput.summary}`);
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
