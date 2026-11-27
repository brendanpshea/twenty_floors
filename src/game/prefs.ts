import type { AnimationSpeed, HelpMode } from '../core/types';
import type { StorageLike } from './deps';

const PREFIX = 'twenty-floors.';

/** Per-device settings: the help level, animation speed, which hints were shown, remembered confirmations. */
export class Prefs {
  constructor(private readonly storage: StorageLike) {}

  private read(key: string): string | null {
    try {
      return this.storage.get(PREFIX + key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage.set(PREFIX + key, value);
    } catch {
      /* ignore */
    }
  }

  help(): HelpMode | null {
    const v = this.read('help');
    return v === 'guided' || v === 'standard' ? v : null;
  }

  setHelp(mode: HelpMode): void {
    this.write('help', mode);
  }

  speed(): AnimationSpeed {
    const v = this.read('speed');
    return v === 'fast' || v === 'skip' ? v : 'normal';
  }

  setSpeed(speed: AnimationSpeed): void {
    this.write('speed', speed);
  }

  private seen(): Set<string> {
    try {
      const raw = this.read('hints');
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  hintSeen(id: string): boolean {
    return this.seen().has(id);
  }

  markHint(id: string): void {
    const s = this.seen();
    s.add(id);
    this.write('hints', JSON.stringify([...s]));
  }

  tipsOff(): boolean {
    return this.read('tipsOff') === '1';
  }

  setTipsOff(off: boolean): void {
    this.write('tipsOff', off ? '1' : '0');
  }

  remembered(key: string): boolean {
    return this.read(`remember.${key}`) === '1';
  }

  remember(key: string): void {
    this.write(`remember.${key}`, '1');
  }
}
