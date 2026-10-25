---
title: What I learned moving Python programs to Rust, and what got faster
published: 2026-10-24
description: "Notes from porting several Python programs to Rust in 2026: the startup win, the FFI tax, the numbers I could not measure, and bugs that were not the borrow checker."
thumbnail: ./thumb.webp
tags: [Rust, Python, Performance, Opinion]
category: Thoughts
draft: false
---

This year I moved several of my Python programs to Rust. Some were small and some were not. I will keep their names out of this post. Below is what I learned, the numbers I can back up, and a clear note on the ones I cannot.

## What I did not measure

Most of the port work has no before-and-after benchmark. For the full rewrites I have no Python-versus-Rust timing at all, so I am not claiming a speedup for them. The numbers below come from commit messages where I wrote down a measurement, from a couple of benchmark files, and from performance fixes that happened during the port. Each number says where it came from.

![Invented terminal output of a benchmark command for a made-up service, with a table of stages, baseline and candidate times, and speedups.](./terminal.webp)

*Illustrative sample, not real output. The names and numbers are invented to show the layout of a before-and-after report.*

## Startup was the clearest win

A small helper script that ran on every event in a long-lived session was written in Python. Its import step took 7.5 seconds. With 30 to 40 of them starting at once, the machine went past 150 percent CPU. I replaced it with a self-contained Rust binary. My commit message says it starts in about 12 ms. That is a commit-message number, not a benchmark, but the gap is big enough that I believe the direction.

This is the case where I would credit the language most: a short-lived process that pays the import cost on every call. For a long-running server I have no Python-versus-Rust timing.

## The FFI boundary took a lot back

For the numeric parts I used PyO3 and kept the Python code as a fallback. A day-by-day simulation loop ran 6.9 times faster per run, 8 ms against 55 ms with marshalling included, on a 2,000-day input. That result looked great.

A metrics function did not hold up. It was 5.1 times faster on 200 items and 2.3 times faster on 1,000, because the cost of passing each column across the boundary grows with the input.

Dates were the worst part. I passed them as ISO strings first. Profiling showed that formatting the strings dominated the boundary cost and turned the faster core into a 7 times regression. Integer day ordinals were about 35 times cheaper to marshal, and they removed a dependency.

![Invented sampled call-stack view for a made-up service, with function widths as shares of samples.](./flame.webp)

*Illustrative sample, not real output. The call stacks and percentages are invented.*

So count the boundary before you count the compute.

## The biggest win was not the language

The largest documented speedup I have is a git history scan. A cold call dropped from 2,195 ms to 832 ms. A memo hit still takes 308 ms under live load, mostly for listing refs. The gain came from asking git to filter before parsing, and from caching per ref snapshot. Any language would need that change. I wrote it in Rust, but Rust is not what made it fast.

A second one: a lookup behind a status call made about 1,000 connection checkouts per call. One query replaced them, and it measured 28 ms for 512 pairs on the live database. Again, an algorithm change.

The third is a memory change. Switching a service to mimalloc cut its peak memory by 23 percent and retired instructions by 35 percent, on a replay of several hundred sessions with identical output. That comparison is Rust against Rust, so it says nothing about Python.

## A miss

A calculation engine I built on a formula library missed most of its targets. On a 100,000-row sheet, a full recompute took about 15.6 seconds against a 1.5 second target. A single edit took about 1.6 seconds against 30 ms. Loading a snapshot took 19 ms, well inside its target.

The pinned formula library has no partial-evaluation API, so every edit is a full pass over 400,000 formula cells. The regression gate only checks for a 20 percent slowdown against the last baseline, not against the target. I have not fixed it.

## The bugs were not the borrow checker

The borrow checker cost me some time, but not the kind that mattered. These did:

- A blocking database mutex was taken on async worker threads. The server went silent five times in six hours, with 15 of 16 workers parked on the same lock. The fix was a bounded lock and a watchdog thread. The proper fix, a writer actor, is still pending.
- A cache cleanup step on a shared CI runner pruned the cargo home that other jobs were using, so unrelated builds failed. I made the cache opt-in on shared runners.
- `cargo test` runs every test in one process, so a test that changes an environment variable breaks its neighbours. The fix was to inject paths instead of changing the environment.
- A parity audit of one port found well over a hundred gaps between the Python reference and the Rust code. Some functions existed only for tests and were never wired into the real call path.
- Rust and SciPy floats differed by 1 to 3 ULPs in some summations. My tests use tolerances between 1e-9 and 1e-6, depending on the helper.
- A bare `except` around the Rust calls hid failures. A logged warning fixed that, and I should have had it from the start.
- In one repo the port was "essentially complete" but the wiring was not. Seven ported modules sat orphaned until an audit caught them.

## Timeline

- **One tool:** a small Rust helper first, the server port a few months later, then the CLI. The Python source tree was deleted in one commit shortly after, and the PyO3 crates went the day after.
- **Another:** the first Rust crate, then a dual-run harness to compare outputs side by side, then a checkpoint that deleted the whole Python engine tree.
- **A bridge package:** Python retired in a commit I titled "final Rust cutover".

## What stayed in Python

ML training, pandas workflows, the React and TypeScript front ends, shell glue, and the GPU model workers, which a Rust process starts. I did not port those and I do not plan to.

## Tooling that paid off

Pin one exact Rust version and use it in both the local toolchain file and CI. Mine said "stable" locally and pinned an older release in CI, so the two disagreed and a green build could drift underneath me.

## What I would do differently

These are my own opinions, not conclusions from the numbers above.

- Benchmark both sides before porting, with the same input and a note about the machine.
- Measure the FFI boundary at the start, not after the first regression.
- Never hold a blocking lock on an async worker thread.
- Keep the Python reference until a parity audit has run, not until the port looks finished.

## Where I am

Rust made a few short processes much faster. It made some numeric loops faster until the boundary ate part of the gain. The biggest real wins were algorithm changes made during the port. I do not have a clean Python-versus-Rust number for a whole tool yet, and that is the next thing I want to measure.
