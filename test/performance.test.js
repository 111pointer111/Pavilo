import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('performance utilities', () => {
  let Performance;

  async function setup() {
    Performance = await import('../client/performance.js');
  }

  describe('batch updater', () => {
    it('collects operations and flushes in next frame', async (t) => {
      await setup();
      let executed = 0;
      const mockWindow = {
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        setTimeout: (cb, ms) => setTimeout(cb, ms),
      };

      const batcher = Performance.createBatchUpdater(mockWindow);
      batcher.schedule(() => { executed++; });
      batcher.schedule(() => { executed++; });
      batcher.schedule(() => { executed++; });

      assert.equal(executed, 0);
      assert.equal(batcher.pending, true);
      assert.equal(batcher.size, 3);

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(executed, 3);
      assert.equal(batcher.pending, false);
    });

    it('handles errors in individual operations', async () => {
      await setup();
      let success = 0;
      const mockWindow = {
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        setTimeout: (cb, ms) => setTimeout(cb, ms),
      };

      const batcher = Performance.createBatchUpdater(mockWindow);
      batcher.schedule(() => { success++; });
      batcher.schedule(() => { throw new Error('test error'); });
      batcher.schedule(() => { success++; });

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(success, 2);
    });

    it('clear cancels pending operations', async () => {
      await setup();
      let executed = 0;
      const mockWindow = {
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        setTimeout: (cb, ms) => setTimeout(cb, ms),
      };

      const batcher = Performance.createBatchUpdater(mockWindow);
      batcher.schedule(() => { executed++; });
      batcher.schedule(() => { executed++; });
      batcher.clear();

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(executed, 0);
      assert.equal(batcher.size, 0);
    });
  });

  describe('throttle', () => {
    it('limits function calls to once per delay', async () => {
      await setup();
      let calls = 0;
      const mockWindow = { setTimeout, clearTimeout, Date };

      const throttled = Performance.throttle(() => { calls++; }, 50, mockWindow);

      throttled();
      throttled();
      throttled();
      assert.equal(calls, 1);

      await new Promise((resolve) => setTimeout(resolve, 60));
      throttled();
      assert.equal(calls, 2);
    });
  });

  describe('debounce', () => {
    it('delays execution until calls stop', async () => {
      await setup();
      let calls = 0;
      const mockWindow = { setTimeout, clearTimeout };

      const debounced = Performance.debounce(() => { calls++; }, 50, mockWindow);

      debounced();
      debounced();
      debounced();
      assert.equal(calls, 0);

      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(calls, 1);
    });
  });

  describe('batchInsert', () => {
    it('handles empty or null nodes gracefully', async () => {
      await setup();
      // Just verify the function exists and handles edge cases
      Performance.batchInsert(null, []);
      Performance.batchInsert(null, null);
      assert.ok(true);
    });
  });

  describe('batchReplace', () => {
    it('handles empty replacement gracefully', async () => {
      await setup();
      // Just verify the function exists and handles edge cases
      Performance.batchReplace(null, []);
      Performance.batchReplace(null, null);
      assert.ok(true);
    });
  });

  describe('calculateVisibleRange', () => {
    it('calculates visible item range with overscan', async () => {
      await setup();
      const mockContainer = {
        scrollTop: 200,
        clientHeight: 400,
      };

      const range = Performance.calculateVisibleRange(mockContainer, 50, 2);
      assert.equal(typeof range.start, 'number');
      assert.equal(typeof range.end, 'number');
      assert.ok(range.start >= 0);
      assert.ok(range.end > range.start);
    });

    it('returns zero range for null container', async () => {
      await setup();
      const range = Performance.calculateVisibleRange(null, 50);
      assert.equal(range.start, 0);
      assert.equal(range.end, 0);
    });
  });

  describe('smartUpdate', () => {
    it('function exists and handles null element', async () => {
      await setup();
      Performance.smartUpdate(null, { textContent: 'test' });
      assert.ok(true);
    });
  });

  describe('shouldRebuildList', () => {
    it('detects when list needs rebuilding', async () => {
      await setup();
      const list1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const list2 = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const list3 = [{ id: 1 }, { id: 3 }, { id: 2 }];
      const list4 = [{ id: 1 }, { id: 2 }];

      assert.equal(Performance.shouldRebuildList(list1, list2), false);
      assert.equal(Performance.shouldRebuildList(list1, list3), true);
      assert.equal(Performance.shouldRebuildList(list1, list4), true);
      assert.equal(Performance.shouldRebuildList(null, list1), true);
    });
  });

  describe('measurePerformance', () => {
    it('executes operation and returns result', async () => {
      await setup();
      const mockWindow = {
        performance: { now: () => Date.now() },
      };

      const result = Performance.measurePerformance('test', () => 42, mockWindow);
      assert.equal(result, 42);
    });

    it('handles missing performance API', async () => {
      await setup();
      const mockWindow = {};

      const result = Performance.measurePerformance('test', () => 99, mockWindow);
      assert.equal(result, 99);
    });
  });
});
