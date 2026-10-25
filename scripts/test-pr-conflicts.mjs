// Unit tests for .github/scripts/pr-conflicts.mjs. Run: pnpm test:pr-conflicts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOOTER,
  LABEL,
  MARKER,
  conflictBody,
  conflictState,
  decide,
  overlapFiles,
  resolvedBody,
  sweep,
} from '../.github/scripts/pr-conflicts.mjs';

const pr = (over = {}) => ({
  number: 7,
  draft: false,
  mergeable: true,
  mergeable_state: 'clean',
  head: { ref: 'feat/x', sha: 'abc123' },
  labels: [],
  ...over,
});

test('conflictState: null until GitHub computes mergeable', () => {
  assert.equal(conflictState(pr({ mergeable: null, mergeable_state: 'unknown' })), null);
});

test('conflictState: dirty or mergeable=false is conflicted, even for drafts', () => {
  assert.equal(conflictState(pr({ mergeable: false, mergeable_state: 'dirty' })), true);
  assert.equal(conflictState(pr({ mergeable: false, mergeable_state: 'draft', draft: true })), true);
  assert.equal(conflictState(pr({ mergeable: true, mergeable_state: 'blocked' })), false);
});

test('decide: conflict on a ready PR adds label and creates one comment', () => {
  assert.deepEqual(decide({ conflicted: true, draft: false, hasLabel: false, existing: null }), {
    label: 'add',
    comment: 'create',
  });
});

test('decide: conflict on a draft labels but never comments', () => {
  assert.deepEqual(decide({ conflicted: true, draft: true, hasLabel: false, existing: null }), {
    label: 'add',
    comment: 'none',
  });
});

test('decide: existing conflict comment is reused, not duplicated', () => {
  const existing = { id: 1, body: conflictBody({ pr: pr(), files: null, mention: true }) };
  assert.deepEqual(decide({ conflicted: true, draft: false, hasLabel: true, existing }), {
    label: 'none',
    comment: 'update',
  });
});

test('decide: resolved PR removes label and edits the comment once', () => {
  const existing = { id: 1, body: conflictBody({ pr: pr(), files: null, mention: true }) };
  assert.deepEqual(decide({ conflicted: false, draft: false, hasLabel: true, existing }), {
    label: 'remove',
    comment: 'resolve',
  });
  const already = { id: 1, body: resolvedBody() };
  assert.deepEqual(decide({ conflicted: false, draft: false, hasLabel: false, existing: already }), {
    label: 'none',
    comment: 'none',
  });
});

test('decide: unknown state changes nothing', () => {
  assert.deepEqual(decide({ conflicted: null, draft: false, hasLabel: true, existing: null }), {
    label: 'none',
    comment: 'none',
  });
});

test('overlapFiles: only files changed on both sides, sorted', () => {
  assert.deepEqual(overlapFiles(['b.md', 'a.md', 'c.md'], ['c.md', 'b.md', 'z.md']), ['b.md', 'c.md']);
});

test('conflictBody: mention only at creation, footer last, no leading prefix', () => {
  const created = conflictBody({ pr: pr(), files: ['src/a.ts'], mention: true });
  const updated = conflictBody({ pr: pr(), files: null, mention: false });
  assert.ok(created.startsWith(MARKER));
  assert.ok(created.includes('@ningsuhen'));
  assert.ok(!updated.includes('@ningsuhen'));
  assert.ok(created.endsWith(FOOTER));
  assert.ok(created.includes('`src/a.ts`'));
  assert.ok(created.includes('git fetch origin && git merge origin/master'));
});

test('conflictBody: PR-controlled text cannot mention, inject markup or markers', () => {
  const hostile = pr({ head: { ref: '@victim<!-- pr-conflict-bot -->`x', sha: 'x' } });
  const body = conflictBody({ pr: hostile, files: ['a`@b<c>.md'], mention: false });
  const inner = body.slice(0, body.length - FOOTER.length);
  assert.equal(inner.split(MARKER).length, 2, 'marker appears once');
  assert.ok(!inner.includes('@victim') && !inner.includes('a`@'));
});

test('resolvedBody: says resolved and ends with the footer', () => {
  const body = resolvedBody();
  assert.ok(body.includes('Conflict resolved'));
  assert.ok(body.endsWith(FOOTER));
});

function fakeGithub({ pulls, comments = {}, compare = {} }) {
  const calls = [];
  const store = { pulls, comments, labels: new Set(), nextId: 900 };
  const rest = {
    pulls: {
      list: async () => ({ data: Object.values(store.pulls).map((p) => ({ number: p.number })) }),
      get: async ({ pull_number }) => {
        const next = store.pulls[pull_number].queue?.shift();
        if (next) store.pulls[pull_number].current = next;
        return { data: { ...store.pulls[pull_number].current, labels: store.pulls[pull_number].labels } };
      },
    },
    repos: {
      compareCommitsWithBasehead: async ({ basehead }) => {
        const files = compare[basehead] ?? [];
        return { data: { files: files.map((filename) => ({ filename })) } };
      },
    },
    issues: {
      listComments: async ({ issue_number }) => ({ data: store.comments[issue_number] ?? [] }),
      createComment: async ({ issue_number, body }) => {
        calls.push(['create', issue_number]);
        (store.comments[issue_number] ??= []).push({ id: ++store.nextId, body, user: { type: 'Bot' } });
      },
      updateComment: async ({ comment_id, body }) => {
        calls.push(['update', comment_id]);
        for (const list of Object.values(store.comments)) {
          const c = list.find((x) => x.id === comment_id);
          if (c) c.body = body;
        }
      },
      addLabels: async ({ issue_number }) => {
        calls.push(['addLabel', issue_number]);
        store.pulls[issue_number].labels.push({ name: LABEL.name });
      },
      removeLabel: async ({ issue_number }) => {
        calls.push(['removeLabel', issue_number]);
        store.pulls[issue_number].labels = store.pulls[issue_number].labels.filter((l) => l.name !== LABEL.name);
      },
      getLabel: async ({ name }) => {
        if (!store.labels.has(name)) throw Object.assign(new Error('nf'), { status: 404 });
        return { data: { name } };
      },
      createLabel: async ({ name }) => {
        calls.push(['createLabel', name]);
        store.labels.add(name);
      },
    },
  };
  const github = {
    rest,
    paginate: async (method, params) => (await method(params)).data,
  };
  return { github, store, calls };
}

const noSleep = async () => {};

test('sweep: dirty PR gets label + one mention comment; second run edits, not duplicates', async () => {
  const { github, store, calls } = fakeGithub({
    pulls: { 7: { number: 7, current: pr({ mergeable: false, mergeable_state: 'dirty' }), labels: [] } },
    compare: { 'master...abc123': ['a.md', 'b.md'], 'abc123...master': ['b.md'] },
  });
  await sweep(github, { owner: 'o', repo: 'r', sleep: noSleep });
  assert.deepEqual(calls.map((c) => c[0]), ['createLabel', 'addLabel', 'create']);
  assert.equal(store.comments[7].length, 1);
  assert.ok(store.comments[7][0].body.includes('@ningsuhen'));
  assert.ok(store.comments[7][0].body.includes('`b.md`'));

  calls.length = 0;
  await sweep(github, { owner: 'o', repo: 'r', sleep: noSleep });
  assert.deepEqual(calls.map((c) => c[0]), ['update'], 'no label churn, comment edited in place');
  assert.equal(store.comments[7].length, 1);
  assert.ok(!store.comments[7][0].body.includes('@ningsuhen'), 'no mention on edits');
});

test('sweep: resolving removes the label and marks the comment resolved', async () => {
  const { github, store, calls } = fakeGithub({
    pulls: { 7: { number: 7, current: pr({ mergeable: false, mergeable_state: 'dirty' }), labels: [] } },
  });
  await sweep(github, { owner: 'o', repo: 'r', sleep: noSleep });
  store.pulls[7].current = pr({ mergeable: true, mergeable_state: 'clean' });
  calls.length = 0;
  await sweep(github, { owner: 'o', repo: 'r', sleep: noSleep });
  assert.deepEqual(calls.map((c) => c[0]), ['removeLabel', 'update']);
  assert.ok(store.comments[7][0].body.includes('Conflict resolved'));
  assert.equal(store.pulls[7].labels.length, 0);
});

test('sweep: draft conflict is labelled but gets no comment', async () => {
  const { github, store } = fakeGithub({
    pulls: { 8: { number: 8, current: pr({ number: 8, draft: true, mergeable: false, mergeable_state: 'draft' }), labels: [] } },
  });
  await sweep(github, { owner: 'o', repo: 'r', sleep: noSleep });
  assert.equal(store.pulls[8].labels.length, 1);
  assert.equal(store.comments[8], undefined);
});

test('sweep: mergeable null is re-requested up to 5 times, then skipped', async () => {
  const sleeps = [];
  const { github, store, calls } = fakeGithub({
    pulls: { 9: { number: 9, current: pr({ number: 9, mergeable: null, mergeable_state: 'unknown' }), labels: [] } },
  });
  let gets = 0;
  const original = github.rest.pulls.get;
  github.rest.pulls.get = async (args) => {
    gets++;
    return original(args);
  };
  await sweep(github, { owner: 'o', repo: 'r', sleep: async (ms) => sleeps.push(ms) });
  assert.equal(gets, 6);
  assert.deepEqual(sleeps, [3000, 3000, 3000, 3000, 3000]);
  assert.deepEqual(calls, []);
  assert.equal(store.comments[9], undefined);
});

test('sweep: a human comment that merely quotes the marker is ignored', async () => {
  const { github, store, calls } = fakeGithub({
    pulls: { 10: { number: 10, current: pr({ number: 10, mergeable: false, mergeable_state: 'dirty' }), labels: [] } },
    comments: { 10: [{ id: 5, body: `${MARKER} spoof`, user: { type: 'User' } }] },
  });
  await sweep(github, { owner: 'o', repo: 'r', sleep: noSleep });
  assert.ok(calls.some((c) => c[0] === 'create'));
  assert.equal(store.comments[10][0].body, `${MARKER} spoof`);
});
