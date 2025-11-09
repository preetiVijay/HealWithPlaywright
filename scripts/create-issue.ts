import fs from 'fs';
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.GITHUB_TOKEN;
if (!token) {
    console.warn('GITHUB_TOKEN not set — skipping create-issue');
    process.exit(0);
}

const octokit = new Octokit({ auth: token });

async function run() {
    const reportPath = 'playwright-report.json';
    if (!fs.existsSync(reportPath)) {
        console.log('Report file not found.');
        return;
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    // Collect failed tests
    const failures: Array<{ title: string, file: string, error: string }> = [];
    if (report && report.suites) {
        for (const suite of report.suites) {
            for (const spec of suite.specs || []) {
                for (const test of spec.tests || []) {
                    if (test.status === 'failed') {
                        failures.push({ title: test.title, file: spec.file, error: (test.err && test.err.message) || 'failed' });
                    }
                }
            }
        }
    }

    if (failures.length === 0) {
        console.log('No failures found — nothing to report.');
        return;
    }

    const [owner, repo] = process.env.GITHUB_REPOSITORY?.split('/') || ['owner', 'repo'];

    // Get existing open issues once
  const existingIssues = await octokit.issues.listForRepo({ owner, repo, state: 'open', per_page: 100 });
  const existingTitles = new Set(existingIssues.data.map(i => i.title));

  for (const f of failures) {
    const title = `E2E failure: ${f.title}`;
    if (existingTitles.has(title)) {
      console.log('Issue already exists for', title);
      continue;
    }
    const body = [
      'Automated report from Playwright run.',
      `**Spec:** ${f.file}`,
      `**Error:**\n\n${f.error}`,
      '(Automatically created by HealPlay scaffold)'
    ].join('\n\n');

    await octokit.issues.create({ owner, repo, title, body });
    console.log('Created issue:', title);
  }
}

run().catch(e => {
  console.error('Error creating issues:', e);
  process.exit(1);
});
