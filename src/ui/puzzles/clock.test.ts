import { describe, expect, it, vi } from 'vitest';
import { RunClock } from './clock';

/** performance.now() is faked by vi.useFakeTimers, so advancing time advances the clock source. */
function setup(hidden = false): RunClock {
  vi.useFakeTimers();
  return new RunClock(() => performance.now(), hidden);
}

describe('RunClock', () => {
  it('does not run before the first move', () => {
    const c = setup();
    vi.advanceTimersByTime(5000);
    expect(c.seconds()).toBe(0);
    c.start();
    vi.advanceTimersByTime(2000);
    expect(c.seconds()).toBeCloseTo(2, 1);
    vi.useRealTimers();
  });

  it('stops while a dialog (explainer or skip confirmation) is open', () => {
    const c = setup();
    c.start();
    vi.advanceTimersByTime(3000);
    c.block();
    vi.advanceTimersByTime(60000);
    expect(c.seconds()).toBeCloseTo(3, 1);
    c.unblock();
    vi.advanceTimersByTime(1000);
    expect(c.seconds()).toBeCloseTo(4, 1);
    vi.useRealTimers();
  });

  it('counts nested dialogs until the last one closes', () => {
    const c = setup();
    c.start();
    c.block();
    c.block();
    vi.advanceTimersByTime(10000);
    c.unblock();
    vi.advanceTimersByTime(10000);
    expect(c.seconds()).toBe(0);
    c.unblock();
    vi.advanceTimersByTime(1000);
    expect(c.seconds()).toBeCloseTo(1, 1);
    vi.useRealTimers();
  });

  it('stops while the tab is hidden and resumes when it returns', () => {
    const c = setup();
    c.start();
    vi.advanceTimersByTime(2000);
    c.setHidden(true);
    vi.advanceTimersByTime(30000);
    expect(c.seconds()).toBeCloseTo(2, 1);
    c.setHidden(false);
    vi.advanceTimersByTime(1500);
    expect(c.seconds()).toBeCloseTo(3.5, 1);
    vi.useRealTimers();
  });

  it('a hidden tab plus an open dialog resumes only when both clear', () => {
    const c = setup();
    c.start();
    vi.advanceTimersByTime(1000);
    c.block();
    c.setHidden(true);
    vi.advanceTimersByTime(5000);
    c.setHidden(false);
    vi.advanceTimersByTime(5000);
    expect(c.seconds()).toBeCloseTo(1, 1);
    c.unblock();
    vi.advanceTimersByTime(1000);
    expect(c.seconds()).toBeCloseTo(2, 1);
    vi.useRealTimers();
  });

  it('starts already paused when created with the tab hidden, and stops for good on stop()', () => {
    const c = setup(true);
    c.start();
    vi.advanceTimersByTime(4000);
    expect(c.seconds()).toBe(0);
    c.setHidden(false);
    vi.advanceTimersByTime(2000);
    c.stop();
    vi.advanceTimersByTime(9000);
    expect(c.seconds()).toBeCloseTo(2, 1);
    vi.useRealTimers();
  });
});
