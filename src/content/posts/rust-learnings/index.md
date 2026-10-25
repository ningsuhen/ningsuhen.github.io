---
title: What I learned rewriting Python programs in Rust, and what got faster
published: 2026-10-24
description: "Notes from rewriting several Python programs in Rust this year: the startup win, the FFI tax, the reliability changes and their limits, and a checklist for deciding."
thumbnail: ./thumb.webp
tags: [Rust, Python, Performance, Opinion]
category: Thoughts
draft: false
---

This year I rewrote several of my Python programs in Rust. Some were small and some were not. I will keep their names out of this post. Below is what I learned, and a checklist for deciding whether the same move makes sense for you.

**TL;DR**

- The clearest speed win was a short-lived helper process. Most other speed gains came from algorithm changes made during the rewrite.
- The FFI boundary can take back most of a numeric gain. Count the crossings first.
- Fewer Python runtime-error fixes followed the rewrite. Hangs, timeouts and panics did not go away.
- Benchmark the old version on the same input before you start. Keep it as the reference until a parity audit passes.

## What I did not measure

Most of the rewrite work has no before-and-after benchmark. For the full rewrites I have no Python-versus-Rust timing at all, so I am not claiming a speedup for them. The numbers below come from commit messages, a couple of benchmark files and performance fixes made during the rewrite. Each says where it came from.

![Invented terminal output of a benchmark command for a made-up service, with a table of stages, baseline and candidate times, and speedups.](./terminal.webp)

*Illustrative sample, not real output. The names and numbers are invented to show the layout of a before-and-after report.*

## Startup was the clearest win

A small helper script that ran on every event in a long-lived session was written in Python. Its import step took 7.5 seconds. With 30 to 40 of them starting at once, the machine went past 150 percent CPU. I replaced it with a self-contained Rust binary. My commit message says it starts in about 12 ms.

That is a commit-message number, not a benchmark. The comparison also mixes the language with the import tree. A lazy-import Python version would show how much of the gap is the language. For a long-running server I have no Python-versus-Rust timing.

## The FFI boundary took a lot back

For the numeric parts I used PyO3 and kept the Python code as a fallback. A day-by-day simulation loop ran 6.9 times faster per run, 8 ms against 55 ms with marshalling included, on a 2,000-day input. That result looked great.

A metrics function did not hold up. It was 5.1 times faster on 200 items and 2.3 times faster on 1,000, because the cost of passing each column across the boundary grows with the input.

Dates were the worst part. I passed them as ISO strings first. Profiling showed that formatting the strings dominated the boundary cost and turned the faster core into a 7 times regression. Integer day ordinals were about 35 times cheaper to marshal, and they removed a dependency.

![Invented sampled call-stack view for a made-up service, with function widths as shares of samples.](./flame.webp)

*Illustrative sample, not real output. The call stacks and percentages are invented.*

So count the boundary before you count the compute.

## The biggest wins were not the language

The largest documented speedup I have is a git history scan. A cold call dropped from 2,195 ms to 832 ms. A memo hit still takes 308 ms under live load, mostly for listing refs. The gain came from filtering before parsing and caching per ref snapshot. Any language would need that.

A second one: a lookup behind a status call made about 1,000 connection checkouts per call. One query replaced them, and it measured 28 ms for 512 pairs on the live database. Again, an algorithm change.

A replay step is the reverse case. The first Rust version was slower than the code it replaced. Fixing how the replay did its work per bar took a session from 132 ms to 11 ms (commit message). The Rust code was not fast on its own.

A third is a memory change. Switching a service to mimalloc cut its peak memory by 23 percent on a replay with identical output. That comparison is Rust against Rust, so it says nothing about Python.

## Reliability: fewer runtime-error fixes, same kinds of failure

I counted fix commits on each side of the rewrite, using subject lines only. These are rough tallies of commit messages, not defect rates.

- **Counted:** about six months of this year, before the last phase of the rewrite: 495 fix commits. Sixteen (about 3 percent) had an error word in the subject: bare or broad except, AttributeError, NoneType, KeyError, TypeError, ValueError, traceback, swallowed, silent.
- **Counted:** the 2.8 months after the Python tree was deleted: 1,780 fix commits. Nine (about 0.5 percent) had the same words.
- **Counted:** import and environment fixes (venv, pip, requirements, ImportError and similar): 7 in the first window, 1 in the second.
- **Counted:** CI memory fixes (worker counts, container limits, OOM retries): about 30 Python-era subjects between late December and mid July, against one in the Rust era, a JavaScript test runner.
- **Judged:** explicit error types made the error paths visible in the code. I read the diffs more than I counted them, and I believe most of the drop comes from that.

Limits, in the same breath. The later window is shorter and covers more features, including a new admin UI and a lot of research code. I think a rewrite attracts fixes in its first weeks whatever the language. Rust fixes also use different words: they say "panic" or "unwrap", not AttributeError. So the drop is real in these counts, but I cannot separate it from the rewrite's own churn.

Python-era fixes looked like this. An assertion fired on None data, and a None value reached a max() call. A timeout never fired at all: the exception was raised in a timer thread and went to the default hook. One cleanup pass replaced twelve bare except blocks with specific types. Python let me catch broadly and move on. That habit is my opinion of the cause, not something the commits prove.

The Rust era still had failures, and they belong in this section:

- A panic in a background task printed one plain line to stderr and never reached the structured logs. The fix logs and counts it.
- A cache client with no timeouts hung every call when the server accepted connections and then stopped answering.
- A logging layer deadlocked itself, because a warning logged while the writer lock was held came back into the same layer.
- An audit found a file read that blocked the async runtime. The planned fix is to move it onto a blocking task.
- **Counted, by path and rough:** about 4,600 unwrap calls, 2,150 expect calls and 470 panic! calls outside test code. Panics are still possible in this code.
- **Memory:** the runtime memory failure I hit was a design error. An analytics endpoint loaded the full stored payloads for tens of thousands of records on every request, and the process ran out of memory. The fix was to stop loading the payloads. Rust did not cause that, and it did not prevent it. A separate fix stopped a background drain task from leaking.

## A miss

A calculation engine I built on a formula library missed most of its targets. On a 100,000-row sheet, a full recompute took about 15.6 seconds against a 1.5 second target. A single edit took about 1.6 seconds against 30 ms. Loading a snapshot took 19 ms, well inside its target.

The pinned formula library has no partial-evaluation API, so every edit is a full pass over 400,000 formula cells. The regression gate only checks for a 20 percent slowdown against the last baseline, not against the target. I have not fixed it.

## Bugs that were not the borrow checker

The borrow checker cost me some time, but not the kind that mattered. These did:

- A blocking database mutex was taken on async worker threads. The server went silent during load, with most workers parked on the same lock. The fix was a bounded lock and a watchdog thread. The proper fix, a writer actor, is still pending.
- A cache cleanup step on a shared CI runner pruned the cargo home that other jobs were using, so unrelated builds failed. I made the cache opt-in on shared runners.
- `cargo test` runs every test in one process, so a test that changes an environment variable breaks its neighbours. The fix was to inject paths instead of changing the environment.

The float drift and the bare except are in the pitfalls below.

## What stayed in Python

ML training, pandas workflows, the React and TypeScript front ends, shell glue, and the GPU model workers, which a Rust process starts. I did not rewrite those and I do not plan to.

## A practical guide

### Decision checklist

- **Short-lived process that starts many times:** strong case. Measure the cold start of the real entry point.
- **Long-running service:** I have no Python-versus-Rust timing for a whole service. The case rests on reliability and packaging, and those are my judgments.
- **Numeric loop:** worth it only if the loop stays inside Rust. Count boundary crossings per call first.
- **Mostly waiting on the network or a database:** expect little speed gain. The gain is in fewer error paths and simpler packaging.
- **Packaging pain** (virtualenvs, interpreter drift): a single binary removed a real chore for me.
- **Budget for a parity audit.** One of mine found well over a hundred gaps between the Python reference and the Rust code.

### Migration path that worked

1. Benchmark the old version on the same input and note the machine.
2. Count how many times data crosses the boundary per call.
3. Rewrite leaf functions first, behind the same Python signature, with the Python version kept as a fallback.
4. Run both implementations on the same inputs and compare outputs. Write one parity test per helper.
5. Check that every rewritten module is reachable from the real entry point. Some of mine were not, for a while.
6. Keep the Python reference until the audit passes, then delete it in one commit.

### Pitfalls and fixes

- **Dates across the boundary:** send integers, not strings. Python's `toordinal()` gives one integer per day.

```python
# slow: strings cross the boundary and get parsed on both sides
days = [d.isoformat() for d in dates]
# cheaper: one integer per day
days = [d.toordinal() for d in dates]
```

- **Blocking locks on async threads:** give the lock a deadline, and move blocking work off the async threads.

```rust
// parking_lot mutex: give up instead of parking an async worker forever
let Some(guard) = db.try_lock_for(Duration::from_secs(2)) else {
    return Err(Overloaded);
};
// blocking file or database work goes to the blocking pool
let rows = tokio::task::spawn_blocking(move || load_rows(path)).await?;
```

- **Fallbacks that hide failures:** log the exception before you fall back. My bare except hid a fallback failure until I added a logged warning.

```python
try:
    value = fast_path(data)
except Exception:
    logger.warning("fast path failed, using the reference", exc_info=True)
    value = reference(data)
```

- **Environment variables in tests:** pass paths into functions instead of setting variables that every test shares.
- **Float drift:** some Rust and SciPy sums differed by 1 to 3 ULPs. My tolerances ranged from 1e-9 to 1e-6.
- **Silent defaults:** one Rust helper returned 0.5 for AUC on degenerate input, where the reference returns nan. Another ignored labels other than 0 and 1. The type system caught neither. Write the degenerate cases as tests.
- **Panic policy:** decide it before you start. Unwrap calls in request handlers were a real risk in my code, and one commit converted them to error returns by hand. Turn the rule into a lint if you want it enforced.

### Tooling that paid off

- One exact toolchain in the toolchain file and in CI. Mine said "stable" locally and pinned an older release in CI, so builds could disagree.
- `cargo fmt --check`, `cargo clippy -D warnings`, `cargo deny` (advisories and licences) and `cargo machete` (unused dependencies), in one CI gate.
- `clippy.toml` `disallowed-methods` bans risky calls. I banned task spawning outside one module, so tasks drain on shutdown, and banned cache connections without timeouts.
- `--locked` builds, and a CI check that rejects a lockfile that no longer matches the manifest.

### What I would measure first

- Cold start of the real entry point, old and new, on the same machine.
- Time per call at the real input size, with marshalling included.
- Boundary crossings per request.
- Memory after a long run, not only the peak of one run.
- Output differences in a dual run, as a count.

## Where I am

Rust made a few short processes much faster. It made some numeric loops faster until the boundary ate part of the gain. The biggest real wins were algorithm changes made during the rewrite.

The reliability gain is narrow: fewer Python runtime-error fixes, explicit error paths, and CI gates that block some bad patterns. Hangs, timeouts and panics did not go away, and the memory problem I hit was a design problem. I do not have a clean Python-versus-Rust number for a whole service yet. That is the next thing I want to measure.
