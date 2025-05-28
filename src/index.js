const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function run() {
  try {
    const apiUrl = core.getInput('api-url', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;
    if (!pr) throw new Error('This action must run on pull_request events');

    // 1. Fetch diff
    const diffResp = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner,
        repo,
        pull_number: pr.number,
        mediaType: { format: 'diff' }
      }
    );
    const diff = diffResp.data;

    // 2. Prompt from PR body
    const prompt = pr.body || '';

    const branch = 'main'

    // 3. Build payload
    const payload = { owner, repo, commit: pr.head.sha, diff, prompt, branch };

    // 4. Call Marshal API
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
    
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();