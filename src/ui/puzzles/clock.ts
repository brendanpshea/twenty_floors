/**
 * The puzzle's stopwatch. It runs only while the puzzle has started, the tab
 * is visible, no dialog (explainer, "force the lock" confirmation) is open and
 * it has not been stopped. Pure: the time source is injected so it can be
 * tested without a DOM.
 */
export class RunClock {
  private elapsedMs = 0;
  private last = 0;
  private begun = false;
  private stopped = false;
  private blockers = 0;
  private hidden: boolean;

  constructor(
    private readonly now: () => number,
    hidden = false,
  ) {
    this.hidden = hidden;
  }

  get started(): boolean {
    return this.begun;
  }

  private running(): boolean {
    return this.begun && !this.stopped && !this.hidden && this.blockers === 0;
  }

  /** Bring `elapsedMs` up to date and restart the interval from now. */
  private settle(): void {
    const t = this.now();
    if (this.running()) this.elapsedMs += t - this.last;
    this.last = t;
  }

  /** First move (or the explainer closing): the clock starts once. */
  start(): void {
    if (this.begun) return;
    this.begun = true;
    this.last = this.now();
  }

  /** A dialog opened. */
  block(): void {
    this.settle();
    this.blockers++;
  }

  /** A dialog closed. */
  unblock(): void {
    this.settle();
    this.blockers = Math.max(0, this.blockers - 1);
  }

  setHidden(hidden: boolean): void {
    this.settle();
    this.hidden = hidden;
  }

  stop(): void {
    this.settle();
    this.stopped = true;
  }

  seconds(): number {
    return (this.elapsedMs + (this.running() ? this.now() - this.last : 0)) / 1000;
  }
}
