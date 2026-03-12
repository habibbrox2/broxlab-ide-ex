#!/usr/bin/env node

const { execSync } = require('child_process');
const { readFileSync } = require('fs');

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runQuiet(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim();
}

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function isGitClean() {
  const status = runQuiet('git status --porcelain');
  return status.length === 0;
}

function getCurrentBranch() {
  return runQuiet('git rev-parse --abbrev-ref HEAD');
}

function getRemoteName() {
  const remotes = runQuiet('git remote').split(/\r?\n/).filter(Boolean);
  return remotes[0] || 'origin';
}

function getPackageVersion() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return pkg.version;
}

function main() {
  const bump = process.argv[2] || 'patch';
  const allowed = ['patch', 'minor', 'major', 'prerelease', 'none'];

  if (!allowed.includes(bump)) {
    fail(`Invalid bump type: ${bump}. Valid options: ${allowed.join(', ')}`);
  }

  if (!isGitClean()) {
    fail('Working tree is not clean. Commit or stash changes before running this script.');
  }

  const branch = getCurrentBranch();
  const remote = getRemoteName();

  console.log(`\nCurrent branch: ${branch}`);
  console.log(`Remote: ${remote}`);
  console.log(`Current version: ${getPackageVersion()}`);

  if (bump !== 'none') {
    console.log(`\nBumping version (${bump})...`);
    // npm version will create a commit and tag automatically
    run(`npm version ${bump} -m "chore(release): %s"`);
  } else {
    console.log('\nSkipping version bump (bump=none)');
  }

  console.log('\nPushing commits and tags...');
  run(`git push ${remote} ${branch}`);
  run(`git push ${remote} --tags`);

  console.log('\n✅ Release complete.');
}

main();
