const core   = require('@actions/core');
const github = require('@actions/github');
const fetch  = require('node-fetch');

async function run() {
  try {
    const apiUrl = core.getInput('api-url',    { required: true });
    const apiKey = core.getInput('api-key',    { required: true });
    const token  = core.getInput('github-token') || process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    // Octokit to fetch PR info
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) throw new Error('This action must run on pull_request events');

    // 1️⃣ fetch the diff
    const diffResp = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner, repo, pull_number: prNumber,
        mediaType: { format: 'diff' }
      }
    );
    const diff = diffResp.data; // raw diff text

    // 2️⃣ pull prompt from PR body
    const prompt = github.context.payload.pull_request.body || '';

    // 3️⃣ build payload
    const payload = {
      owner, repo,
      commit: github.context.payload.pull_request.head.sha,
      diff,
      prompt
    };

    // 4️⃣ call Marshal API
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Marshal API error ${res.status}: ${txt}`);
    }
    const result = await res.json();
    console.log('Marshal result:', result);

    // 5️⃣ fail the step if pass=false
    if (!result.pass) {
      core.setFailed(
        `Marshal semantic check FAILED (score=${result.score}) – ${result.reason}`
      );
    } else {
      core.info(`✅ Marshal passed (score=${result.score})`);
    }

  } catch (err) {
    core.setFailed(err.message);
  }
}

run();
