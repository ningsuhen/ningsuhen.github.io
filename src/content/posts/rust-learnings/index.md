---
title: What I learned rewriting Python programs in Rust, and what got faster
published: 2026-10-24
description: "Notes from rewriting several Python programs in Rust this year: the startup win, the FFI tax, which bug classes moved and which did not, whether agent-written code changed the answer, and a checklist for deciding."
thumbnail: ./thumb.webp
tags: [Rust, Python, Performance, Opinion]
category: Thoughts
draft: false
---

This year I rewrote several of my Python programs in Rust. Some were small and some were not. I will keep their names out of this post. A lot of the work was done with AI coding agents, so I also asked whether that changed the answer. Below is what I learned, and a checklist for deciding whether the same move makes sense for you.

**TL;DR**

- The clearest speed win was a short-lived helper process. Most other speed gains came from algorithm changes made during the rewrite.
- The FFI boundary can take back most of a numeric gain. Count the crossings first.
- Some bug classes moved from runtime to compile time. Others changed form, and hangs and design-level memory growth did not move at all.
- Agent-written Rust got early compiler feedback. The compiler did not catch design errors, hangs or calls that a merge dropped, so those still needed tests and review.
- Benchmark the old version on the same input before you start. Keep it as the reference until a parity audit passes.

## What I did not measure

Most of the rewrite work has no before-and-after benchmark. For the full rewrites I have no Python-versus-Rust timing at all, so I am not claiming a speedup for them. The numbers below come from commit messages, a couple of benchmark files and performance fixes made during the rewrite. Each says where it came from.

![Invented terminal output of a benchmark command for a made-up service, with a table of stages, baseline and candidate times, and speedups.](./terminal.webp)

*Illustrative sample, not real output. The names and numbers are invented to show the layout of a before-and-after report.*

## Startup was the clearest win

A small helper script that ran on every call in a long-running process was written in Python. Its import step took 7.5 seconds. With 30 to 40 of them starting at once, the machine went past 150 percent CPU. I replaced it with a self-contained Rust binary. My commit message says it starts in about 12 ms.

That is a commit-message number, not a benchmark. The comparison also mixes the language with the import tree. A lazy-import Python version would show how much of the gap is the language. For a long-running server I have no Python-versus-Rust timing.

## The FFI boundary took a lot back

For the numeric parts I used PyO3 and kept the Python code as a fallback. A day-by-day loop ran 6.9 times faster per run, 8 ms against 55 ms with marshalling included, on a 2,000-day input. That result looked great.

A metrics function did not hold up. It was 5.1 times faster on 200 items and 2.3 times faster on 1,000, because the cost of passing each column across the boundary grows with the input.

Dates were the worst part. I passed them as ISO strings first. Profiling showed that formatting the strings dominated the boundary cost and turned the faster core into a 7 times regression. Integer day ordinals were about 35 times cheaper to marshal, and they removed a dependency.

![Invented sampled call-stack view for a made-up service, with function widths as shares of samples.](./flame.webp)

*Illustrative sample, not real output. The call stacks and percentages are invented.*

So count the boundary before you count the compute.

## The biggest wins were not the language

The largest documented speedup I have is a git history scan. A cold call dropped from 2,195 ms to 832 ms. A memo hit still takes 308 ms under real load, mostly for listing refs. The gain came from filtering before parsing and caching per ref snapshot. Any language would need that.

A second one: a lookup behind a status call made about 1,000 connection checkouts per call. One query replaced them, and it measured 28 ms for 512 pairs on the production database. Again, an algorithm change.

A per-step loop is the reverse case. The first Rust version was slower than the code it replaced. Fixing how the loop did its work per step took a run from 132 ms to 11 ms (commit message). The Rust code was not fast on its own.

A third is a memory change. Switching a service to mimalloc cut its peak memory by 23 percent on a rerun with identical output. That comparison is Rust against Rust, so it says nothing about Python.

## How the bug classes moved

I wanted to know whether the rewrite removed a class of bug or only moved it. For each class I checked when it last showed up in Python code, whether it came back after the port, and what changed the mechanism. Positions are relative, not dates.

- **Counted:** in one repository, about 50 Python-only fix commits had a runtime-error word in the subject (AttributeError, TypeError, NoneType, KeyError). About one Rust-only fix commit did, and about 20 had panic or unwrap. About 260 Python-only fix subjects matched event-loop or blocking words, against about 65 Rust-only. These are subject-line counts with different word lists per language. They are not defect rates.
- **Counted, rough:** in one Rust codebase, about 7,000 lines contain unwrap, about 2,700 contain expect and about 500 contain panic!, test code included.

| Class | Last Python-era case | After the port | Mechanism now | Went away? |
|---|---|---|---|---|
| Class | Last Python-era case | After the port | Mechanism now | Went away? |
|---|---|---|---|---|
| Attribute, type and None errors | Late in the Python period, a row type lacked a method. Tests mocked a dict that had it, so the bug reached production. | Panics and unwraps. A background-task panic printed one stderr line and never reached the logs. | Missing methods are compile errors. Absent values go through Option and Result. A panic is still runtime. | Changed form. |
| Leaks: file descriptors and slots | Early in the Python period, a connection pool handed back open connections. | A slot leaked when a panic skipped a manual decrement. | A guard whose drop runs on every exit path, including unwinding. | Gone for guarded resources. Logic leaks still happen. |
| Memory growth from data design | A CI run hit its container limit after one test accumulated millions of mock records. | A request loaded stored payloads for every row, twelve at a time. The pod ran out of memory. | Not the language. The design loaded too much. | Did not change. |
| Hangs on a dependency | Timeouts were added to the cache clients. Later, a sync timeout did not abort the call. | A cache client with no default timeouts hung every call when the server stopped answering. | Explicit timeouts in one shared place. | Did not change. Same fix. |
| Deadlocks and blocking | About 260 Python-only fix subjects touched event-loop or blocking work. | A logging layer re-entered its own writer lock. A writer lock was held across slow work. | Thread locks, not the event loop. A plain mutex deadlocks when its own thread takes it again. | Changed form. |
| Log floods | Flood fixes in the Python period. | Three always-on logs, one writing tens of thousands of lines a day. | The same. | Did not change. |

**Judged:** most of the drop in runtime-error fixes came from explicit types and error returns. I cannot separate that from the rewrite's own churn.

Plainly, no class went away everywhere. Runtime type errors moved to compile time where types can express them. Leaks lost their Python mechanism for guarded resources. Hangs, data-design memory growth and log floods came back in Rust. The CI memory failures I found were in Python-era commits, and I found fewer in Rust-only commits. The count is rough, so I cannot say they went away.

## A miss

A calculation engine I built on a formula library missed most of its targets. On a 100,000-row sheet, a full recompute took about 15.6 seconds against a 1.5 second target. A single edit took about 1.6 seconds against 30 ms. Loading a snapshot took 19 ms, well inside its target.

The pinned formula library has no partial-evaluation API, so every edit is a full pass over 400,000 formula cells. The regression gate only checks for a 20 percent slowdown against the last baseline, not against the target. I have not fixed it.

## Bugs that were not the borrow checker

The borrow checker cost me some time, but not the kind that mattered. These did:

- A blocking database mutex was taken on async worker threads. The server went silent during load, with most workers parked on the same lock. The fix was a bounded lock and a watchdog thread. The proper fix, a writer actor, is still pending.
- A cache cleanup step on a shared CI runner pruned the cargo home that other jobs were using, so unrelated builds failed. I made the cache opt-in on shared runners.
- `cargo test` runs every test in one process, so a test that changes an environment variable breaks its neighbours. The fix was to inject paths instead of changing the environment.

The float drift and the bare except are in the pitfalls below.

## Did agentic coding change the answer?

The fair comparison is not hand-written Python against agent-written Rust. I could not measure agent use cleanly in either era.

- **Counted:** in one repository, about 1 in 8 Python-only commits carries an explicit co-author trailer that names an AI model. Among Rust-only commits it is about 1 in 100. The broad marker is a trailer or a task id, and the repo also puts task ids on human commits, so it does not measure AI use. The two markers disagree, so I cannot say the eras had matched agent shares. The Rust history is shorter and mixed with other work.

What the compiler gave an agent was a precise error inside its own loop, instead of an incident later:

| Bug | Python: where it surfaced | Rust: where it surfaced |
|---|---|---|
| Method or field missing on a type | Runtime, in production, when tests mocked it away | Compile error. The type does not have that method, so the code does not build. |
| Enum variant added, match not updated | Runtime, or a silent default | Compile error for a non-exhaustive match. One commit made a case compile-time exhaustive across two files. |
| Two branches change one signature and merge close together | Runtime, on the paths the tests reached | Compile break on main after the merge. Two more commits fixed it. The gate ran after the merge, not before. |
| Call dropped during a merge | Silent | Silent. A merge removed the audit calls, and nothing failed to compile because the calls were simply absent. |
| Lint drift | Ruff and mypy red on main. One change waited until the mypy errors were fixed. | Clippy with warnings as errors red across every open pull request for a while, about forty lints. |
| Borrow error | Not applicable | A lifetime error in a test was caught by the compiler and "fixed" with unwrap. |

What got worse:

- **The loop got longer.** Compiles take longer than a Python test run. I have no timing logs, so I cannot give a number.
- **Agents reach for unwrap and clone.** The unwrap line count is the only evidence I have. I did not count clones.
- **Code got wired in late or not at all.** Some new modules were not reached from the entry point, and a merge dropped whole call paths.
- **Merges collided.** Concurrent pull requests merged cleanly in git and still broke the build.

Where Python agent loops were fine: scripts, glue, ML code, and tests against real objects. A Python test run is fast enough to loop on many times. Python's runtime errors were real, and the asyncio blocking was documented, so Python was not free of runtime trouble.

**Judged:** the Python loop worked when the tests ran real objects. The mock case was a test design failure, not a Python one.

Tallies, with their caveats:

- **Counted:** in the most recent 300 CI runs of one repository, about three in four had at least one failing job. Lint and spec failed in about 73 percent of those runs, web UI and security audit in about 64 percent, Rust tests in about 61 percent, and end-to-end in about 22 percent. The lint job also runs a cargo build and advisory Python checkers, so I cannot split compile errors from test failures. I did not measure how many agent iterations ended in compiler errors. The repo keeps no per-iteration log.

Public sources:

- FeedbackEval (arXiv 2504.06939): on code repair tasks, compiler feedback alone gave 49.2 percent success, test feedback 57.9 percent, and both together 63.6 percent, across five language models. It is not a Rust study and not a Python comparison.
- A 2026 preprint (arXiv 2607.13921) gives compiler feedback during generation and tests it on repository-level Rust tasks. Its abstract gives no figures I could check.

Together they support one narrow point: feedback type matters, and compiler feedback alone is not the whole loop.

**Judged:** Rust was worth it for the checks an agent cannot run itself. It was not clearly worth it for fewer bugs overall. The compiler caught the type and enum mistakes early. It did not catch the design memory problem, the hang, or the dropped audit calls. I would still pick Rust for a long-running service with strict resource rules. I would not pick it because an agent can write it unsupervised. What would change my mind is a whole-service comparison with the same agent setup in both languages, measured as time to a correct, green change.

If you use agents on a Rust codebase:

- Run `cargo check`, clippy with warnings as errors, and `cargo deny` in the agent loop, and again in the gate that blocks a merge. A gate that runs after the merge catches the break too late.
- Lint against `unwrap` and `expect` in non-test code, and make each exception explicit.
- Write tests first, including the degenerate inputs. For a port, run the old and new code on the same inputs.
- Check that every new module is reachable from the real entry point, and read merges for calls that went missing.
- Keep pull requests small, and read the diff for removed lines, not only added ones.

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

Rust made a few short processes much faster. It made some numeric loops faster until the boundary ate part of the gain. The biggest real wins were algorithm changes.

The reliability gain is narrow. Some runtime type errors moved to compile time, and guarded resources stopped leaking. Hangs, timeouts and panics did not go away, and the memory problem I hit was a design problem. The compiler caught what it could see. It did not catch what needed a test or a review. I do not have a clean Python-versus-Rust number for a whole service yet. That is the next thing I want to measure, with the same agents on both sides.
