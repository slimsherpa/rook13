import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Several suites replay complete games through real QNet forward
        // passes (neural.test.ts fixtures, search.test.ts rollouts). On the
        // small CI runner those files share two cores, and the 5s default
        // reads as flakiness — deploy #18 died on a gen9 fixture replay
        // that passes in ~2s locally. Give integration-weight tests room.
        testTimeout: 60000,
    },
});
