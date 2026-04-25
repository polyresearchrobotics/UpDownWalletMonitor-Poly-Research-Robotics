class DomeRateLimiter {
  private lastRequest: number = 0;
  private readonly MIN_DELAY = 25;
  private requestQueue: Array<() => void> = [];
  private processing: boolean = false;

  async waitForRateLimit(): Promise<void> {
    return new Promise((resolve) => {
      this.requestQueue.push(resolve);
      this.tryProcessQueue();
    });
  }

  private tryProcessQueue(): void {
    if (this.processing) return;
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.requestQueue.length > 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;

        if (timeSinceLastRequest < this.MIN_DELAY) {
          const waitTime = this.MIN_DELAY - timeSinceLastRequest;
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        this.lastRequest = Date.now();
        const resolve = this.requestQueue.shift();
        if (resolve) resolve();
      }
    } finally {
      this.processing = false;
      if (this.requestQueue.length > 0) this.tryProcessQueue();
    }
  }
}

const domeRateLimiter = new DomeRateLimiter();

export async function waitForDomeRateLimit(): Promise<void> {
  await domeRateLimiter.waitForRateLimit();
}
