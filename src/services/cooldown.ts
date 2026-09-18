export function createCooldownTracker() {
  const until = new Map<string, number>();

  return {
    remaining(key: string, now = Date.now()): number {
      const expires = until.get(key);
      if (!expires) return 0;
      const left = expires - now;
      if (left <= 0) {
        until.delete(key);
        return 0;
      }
      return left;
    },
    hit(key: string, windowMs: number, now = Date.now()): number {
      const left = this.remaining(key, now);
      if (left > 0) return left;
      until.set(key, now + windowMs);
      return 0;
    },
    clear(key: string): void {
      until.delete(key);
    },
  };
}

export type CooldownTracker = ReturnType<typeof createCooldownTracker>;
