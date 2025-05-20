
// File: src/index.js
const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function run() {
  try {
    const apiUrl = core.getInput('api-url', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const prompt = core.getInput('prompt');

    const { owner, repo } = github.context.repo;
    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
      core.setFailed('No pull_request found in the context.');
      return;
    }
    const prNumber = pullRequest.number;

    // Call Marshal API
    const response = await fetch(`${apiUrl}/validate_diff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ repo: `${owner}/${repo}`, prNumber, prompt }),
    });
    const result = await response.json();

    // Create or update a check run
    const octokit = github.getOctokit(apiKey);
    const check = await octokit.rest.checks.create({
      owner,
      repo,
      name: 'marshal/validate',
      head_sha: pullRequest.head.sha,
      status: 'completed',
      conclusion: result.status === 'pass' ? 'success' : 'failure',
      output: {
        title: 'Marshal Validation Report',
        summary: result.status === 'pass' ? '✅ All checks passed' : '🚨 Validation failed',
        text: `**Semantic Score:** ${result.semanticScore}\n` +
              `**Tests:** ${result.tests.lint && result.tests.tests ? '✔ Passed' : '❌ Issues'}\n` +
              (result.previewUrl ? `**Preview:** ${result.previewUrl}` : '')
      }
    });

    if (result.status !== 'pass') {
      core.setFailed('Marshal validation failed.');
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
