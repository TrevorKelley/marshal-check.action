const core   = require('@actions/core');
const github = require('@actions/github');
const fetch  = require('node-fetch');

async function run() {
  try {
    const apiUrl = core.getInput('api-url',    { required: true });
    const apiKey = core.getInput('api-key',    { required: true });
    const token  = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;
    if (!pr) throw new Error('This action must run on pull_request events');
    const commit = pr.head.sha;

    core.info('good so far')

    // 1️⃣ Find the auto-created check run for *this* workflow

    const checkName = process.env.GITHUB_JOB;  

    core.info('ok', checkName)
    const { data: { check_runs } } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: commit,
      check_name: checkName,
    });

    core.info('good so far!')

    if (!check_runs.length) {
      throw new Error(`No check run found named '${checkName}' on ${commit}`);
    }
    const checkRunId = check_runs[0].id;
    core.info(`▶ Using existing check run #${checkRunId} ('${checkName}')`);

    // 2️⃣ Compute diff & prompt exactly as before
    const diffResp = await octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner, repo, pull_number: pr.number, mediaType: { format: 'diff' } }
    );
    const diff = diffResp.data;
    const prompt = pr.body || '';

    core.info('good so far!!')


    branch = 'main'
    // 3️⃣ Fire your Marshal API, including checkRunId
    const payload = { owner, repo, commit, diff, prompt, checkRunId, branch };
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });

    core.info('good so far!!!!')

    if (res.status !== 202) {
      const txt = await res.text();
      throw new Error(`Marshal API error ${res.status}: ${txt}`);
    }

    core.info('✅ Marshal validation kicked off');
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
