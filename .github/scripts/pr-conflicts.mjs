// PR merge-conflict notifier. Runs from .github/workflows/pr-conflicts.yml
// against the GitHub API only. It never checks out or executes PR code, and
// PR-controlled text (branch and file names) is stripped of markup before use.

export const MARKER = '<!-- pr-conflict-bot -->';
export const FOOTER = '\n\n---\n<sub>Ning›🤖›</sub>';
export const RESOLVED_HEADLINE = 'Conflict resolved';
export const OWNER_MENTION = '@ningsuhen';
export const LABEL = { name: 'conflict', color: 'd73a4a', description: 'Conflicts with master' };
export const MAX_REREQUESTS = 5;
export const RETRY_DELAY_MS = 3000;
export const BASE_REF = 'master';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (text) => String(text).replace(/[`@<>\r\n]/g, '');

/** true = conflicted, false = clean, null = GitHub has not computed it yet. */
export function conflictState(pr) {
  if (pr.mergeable == null) return null;
  return pr.mergeable === false || pr.mergeable_state === 'dirty';
}

/**
 * Decide what to do for one PR.
 * label: add | remove | none. comment: create | update | resolve | none.
 * Drafts never get a new comment; an existing one may be refreshed.
 */
export function decide({ conflicted, draft, hasLabel, existing }) {
  if (conflicted === null) return { label: 'none', comment: 'none' };
  if (conflicted) {
    const label = hasLabel ? 'none' : 'add';
    if (!existing) return { label, comment: draft ? 'none' : 'create' };
    if (draft && isResolved(existing.body)) return { label, comment: 'none' };
    return { label, comment: 'update' };
  }
  return {
    label: hasLabel ? 'remove' : 'none',
    comment: existing && !isResolved(existing.body) ? 'resolve' : 'none',
  };
}

export function isResolved(body) {
  return String(body).includes(RESOLVED_HEADLINE);
}

/** Files changed on both sides since the merge-base: candidates for conflicts. */
export function overlapFiles(prFiles, baseFiles) {
  const onBase = new Set(baseFiles);
  return prFiles.filter((file) => onBase.has(file)).sort();
}

export function conflictBody({ pr, files, mention }) {
  const lines = [MARKER];
  const head = `\`${safe(pr.head.ref)}\``;
  const opener = mention ? `${OWNER_MENTION} ` : '';
  lines.push(`${opener}#${pr.number} (${head}) conflicts with \`${BASE_REF}\`, so it no longer merges cleanly.`);
  lines.push('');
  if (files && files.length > 0) {
    lines.push('Files changed on both sides (candidates; git decides the real conflicts):');
    for (const file of files) lines.push(`- \`${safe(file)}\``);
    lines.push('');
  }
  lines.push(
    `To list the exact conflicts, run \`git fetch origin && git merge origin/${BASE_REF}\` in the branch worktree (then \`git merge --abort\`).`,
    `Merging or rebasing \`${BASE_REF}\` into the branch clears this notice.`,
  );
  return lines.join('\n') + FOOTER;
}

export function resolvedBody() {
  return [MARKER, `${RESOLVED_HEADLINE}: this PR merges cleanly with \`${BASE_REF}\` again.`].join('\n') + FOOTER;
}

async function fetchPull(github, { owner, repo, number, sleep }) {
  const get = async () => (await github.rest.pulls.get({ owner, repo, pull_number: number })).data;
  let pr = await get();
  for (let i = 0; i < MAX_REREQUESTS && pr.mergeable == null; i++) {
    await sleep(RETRY_DELAY_MS);
    pr = await get();
  }
  return pr;
}

async function changedFiles(github, { owner, repo, headSha }) {
  try {
    const [prSide, baseSide] = await Promise.all([
      github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${BASE_REF}...${headSha}` }),
      github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${headSha}...${BASE_REF}` }),
    ]);
    const names = (data) => (data.files ?? []).map((file) => file.filename);
    return overlapFiles(names(prSide.data), names(baseSide.data));
  } catch {
    return null;
  }
}

/**
 * Sweep every open PR once. `github` is the actions/github-script client.
 * Each run is a full sweep, so a missed event is caught by the next run.
 */
export async function sweep(github, { owner, repo, sleep = wait, log = () => {} }) {
  const open = await github.paginate(github.rest.pulls.list, { owner, repo, state: 'open', per_page: 100 });
  let labelReady = false;
  for (const listed of open) {
    const pr = await fetchPull(github, { owner, repo, number: listed.number, sleep });
    const conflicted = conflictState(pr);
    if (conflicted === null) {
      log(`#${pr.number}: mergeable not computed yet, skipped`);
      continue;
    }
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: pr.number, per_page: 100,
    });
    const found = comments.find((c) => c.user?.type === 'Bot' && String(c.body).includes(MARKER));
    const existing = found ? { id: found.id, body: found.body } : null;
    const plan = decide({
      conflicted,
      draft: pr.draft,
      hasLabel: pr.labels.some((label) => label.name === LABEL.name),
      existing,
    });
    log(`#${pr.number}: conflicted=${conflicted} label=${plan.label} comment=${plan.comment}`);

    if (plan.label === 'add') {
      if (!labelReady) {
        await ensureLabel(github, { owner, repo });
        labelReady = true;
      }
      await github.rest.issues.addLabels({ owner, repo, issue_number: pr.number, labels: [LABEL.name] });
    }
    if (plan.label === 'remove') {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name: LABEL.name });
    }

    if (plan.comment === 'create') {
      const files = await changedFiles(github, { owner, repo, headSha: pr.head.sha });
      await github.rest.issues.createComment({
        owner, repo, issue_number: pr.number, body: conflictBody({ pr, files, mention: true }),
      });
    } else if (plan.comment === 'update') {
      const files = await changedFiles(github, { owner, repo, headSha: pr.head.sha });
      const body = conflictBody({ pr, files, mention: false });
      if (body !== existing.body) {
        await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
      }
    } else if (plan.comment === 'resolve') {
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: resolvedBody() });
    }
  }
}

async function ensureLabel(github, { owner, repo }) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name: LABEL.name });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.issues.createLabel({ owner, repo, ...LABEL });
  }
}
