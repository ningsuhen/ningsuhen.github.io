/**
 * Continuous playback for stream engines (the neural voice). One producer keeps synthesis ahead of playback,
 * and every chunk is scheduled on the AudioContext clock, back to back, with a short crossfade at each join.
 * Nothing waits for a chunk to finish before the next one is synthesised.
 *
 * Underrun: when the scheduled audio is nearly used up while synthesis is still running, the clock is suspended
 * (so no silent hole is played), the player shows "buffering", and the clock resumes once RESUME_BUFFER_S of
 * audio is scheduled again. Position follows the scheduled audio, not generation.
 */
import type { AudioChunk } from "./engine";

/** How far synthesis may run ahead of playback. Bounds memory and the cost of a Stop. */
export const LOOKAHEAD_S = 15;
/** Scheduled audio below this, while synthesis is still running, suspends the clock. */
export const UNDERRUN_S = 0.25;
/** A suspended clock resumes once this much audio is scheduled again. */
export const RESUME_BUFFER_S = 5;
/** Crossfade at each join. The next chunk starts this much before the previous one ends. */
export const CROSSFADE_S = 0.02;
/** Delay before the first chunk plays, so the first sample is not clipped by scheduling. */
const START_DELAY_S = 0.05;
const TICK_MS = 100;

export interface PipelineHooks {
	/** Called with the sentence whose audio is playing now (from the scheduled timeline). */
	onSentence: (index: number) => void;
	/** Called when playback waits for synthesis (true) and when it resumes (false). */
	onBuffering: (waiting: boolean) => void;
	/** Called once per chunk, after it is accepted for scheduling. `ahead` is scheduled audio in seconds. */
	onChunk?: (durationS: number, ahead: number, first: boolean) => void;
}

interface Scheduled {
	at: number;
	end: number;
	sentence: number;
}

export class Pipeline {
	private nextStart = 0;
	private readonly timeline: Scheduled[] = [];
	private readonly sources: AudioBufferSourceNode[] = [];
	private produced = 0;
	private suspended = false;
	private finished = false;
	private timer: ReturnType<typeof setInterval> | null = null;
	private wake: (() => void) | null = null;
	private lastSentence = -1;

	constructor(
		private readonly ctx: AudioContext,
		private readonly signal: AbortSignal,
		private readonly hooks: PipelineHooks,
	) {
		this.timer = setInterval(() => this.tick(), TICK_MS);
		signal.addEventListener("abort", () => this.dispose(), { once: true });
	}

	/** Schedules one chunk. Waits (without blocking the producer's own work) while too much audio is queued. */
	async push(chunk: AudioChunk, sentence: number): Promise<void> {
		while (!this.signal.aborted && this.ahead() > LOOKAHEAD_S) {
			await this.pause();
		}
		if (this.signal.aborted) return;
		const duration = chunk.samples.length / chunk.sampleRate;
		this.hooks.onChunk?.(duration, this.ahead(), this.produced === 0);
		this.schedule(chunk, sentence);
		this.produced += 1;
		this.resumeIfBuffered();
	}

	/** Schedules silence after the audio so far: a punctuation pause, attributed to the sentence it follows. */
	silence(seconds: number, sentence: number): void {
		if (this.signal.aborted || seconds <= 0) return;
		this.schedule({ samples: new Float32Array(Math.round(seconds * 24000)), sampleRate: 24000 }, sentence);
		this.produced += 1;
		this.resumeIfBuffered();
	}

	/** Resolves when every scheduled chunk has played, or on abort. */
	async drain(): Promise<void> {
		this.finished = true;
		while (!this.signal.aborted && this.ahead() > 0) {
			await this.pause(this.ahead() * 1000);
		}
		this.dispose();
	}

	/** Seconds of scheduled audio still to play (frozen while suspended). */
	private ahead(): number {
		return Math.max(0, this.nextStart - this.ctx.currentTime);
	}

	private schedule(chunk: AudioChunk, sentence: number): void {
		const buffer = this.ctx.createBuffer(1, chunk.samples.length, chunk.sampleRate);
		buffer.copyToChannel(chunk.samples as Float32Array<ArrayBuffer>, 0);
		const duration = buffer.duration;
		const now = this.ctx.currentTime;
		const fade = Math.min(CROSSFADE_S, duration / 4);
		const start = this.produced === 0 ? now + START_DELAY_S : Math.max(this.nextStart - fade, now + 0.01);
		const gain = this.ctx.createGain();
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(1, start + fade);
		gain.gain.setValueAtTime(1, start + duration - fade);
		gain.gain.linearRampToValueAtTime(0, start + duration);
		const source = this.ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(gain).connect(this.ctx.destination);
		source.start(start);
		source.onended = () => {
			const at = this.sources.indexOf(source);
			if (at >= 0) this.sources.splice(at, 1);
		};
		this.sources.push(source);
		this.timeline.push({ at: start, end: start + duration, sentence });
		this.nextStart = start + duration;
	}

	/** Watchdog: detects underrun, suspends the clock, and reports position. */
	private tick(): void {
		if (this.signal.aborted) return;
		this.reportSentence();
		if (this.finished || this.suspended || this.produced === 0) return;
		if (this.ahead() < UNDERRUN_S) this.suspend();
	}

	private suspend(): void {
		this.suspended = true;
		void this.ctx.suspend();
		this.hooks.onBuffering(true);
	}

	private resumeIfBuffered(): void {
		if (!this.suspended) return;
		if (this.ahead() >= RESUME_BUFFER_S || this.finished) {
			this.suspended = false;
			void this.ctx.resume();
			this.hooks.onBuffering(false);
		}
	}

	private reportSentence(): void {
		const now = this.ctx.currentTime;
		let current = -1;
		for (const entry of this.timeline) {
			if (entry.at <= now) current = entry.sentence;
			else break;
		}
		if (current >= 0 && current !== this.lastSentence) {
			this.lastSentence = current;
			this.hooks.onSentence(current);
		}
	}

	/** Waits for the next tick (or a wake-up) so the producer yields to playback. */
	private pause(ms = TICK_MS): Promise<void> {
		return new Promise<void>((resolve) => {
			const done = (): void => {
				clearTimeout(timer);
				this.wake = null;
				resolve();
			};
			const timer = setTimeout(done, ms);
			this.wake = done;
		}).then(() => {
			this.resumeIfBuffered();
		});
	}

	private dispose(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		this.wake?.();
		for (const source of this.sources) {
			try {
				source.stop();
			} catch {
				// Already ended.
			}
		}
		this.sources.length = 0;
		if (this.suspended) {
			this.suspended = false;
			void this.ctx.resume();
		}
	}
}
