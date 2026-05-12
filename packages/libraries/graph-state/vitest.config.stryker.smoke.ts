import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        include: [
            'tests/apply/requestFit.test.ts',
            'tests/apply/setPan.test.ts',
            'tests/apply/setZoom.test.ts',
        ],
    },
})
