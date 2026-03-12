#!/usr/bin/env node

const { execSync } = require('child_process');
const { readFileSync, writeFileSync } = require('fs');

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

function getLatestTag() {
  try {
    return runQuiet('git describe --tags --abbrev=0');
  } catch (err) {
    return null;
  }
}

function getCommitInfo() {
  const commit = runQuiet('git rev-parse --short HEAD');
  const date = runQuiet('git show -s --format=%cI HEAD');
  return { commit, date };
}

function updateReleaseNotes(tag, commit, date) {
  const file = 'broxlab-docs.md';
  const content = readFileSync(file, 'utf8');
  const startMarker = '<!-- RELEASE_NOTES_START -->';
  const endMarker = '<!-- RELEASE_NOTES_END -->';
  const regex = new RegExp(`(${startMarker})([\s\S]*?)(${endMarker})`, 'm');

  console.log('Release note markers:', {
    start: content.indexOf(startMarker),
    end: content.indexOf(endMarker),
    regexMatch: regex.test(content),
  });

  if (!regex.test(content)) {
    console.warn(`\n⚠️ Could not find release notes markers in ${file}. Skipping update.`);
    return;
  }

  const replacement = `${startMarker}\n- **Tag:** ${tag}\n- **Commit:** \`${commit}\`\n- **Date:** ${date}\n${endMarker}`;
  const updated = content.replace(regex, replacement);
  writeFileSync(file, updated, 'utf8');
  run(`git add ${file}`);
  run(`git commit -m "docs: update release notes for ${tag}"`);
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

  const tag = getLatestTag() || getPackageVersion();
  const { commit, date } = getCommitInfo();
  updateReleaseNotes(tag, commit, date);

    console.log('\nPushing commits and tags...');
    run(`git push ${remote} ${branch}`);
    run(`git push ${remote} --tags`);

    console.log('\n✅ Release complete.');
}

main();
