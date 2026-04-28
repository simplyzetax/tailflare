import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				assets: {
					directory: './test-assets',
					notFoundHandling: 'single-page-application',
					runWorkerFirst: ['/api/*', '/rpc/*', '/scalar'],
				},
				bindings: {
					AUTH_SECRET: 'test-secret-at-least-32-bytes-long',
					NODE_ENV: 'test',
				},
			},
		}),
	],
	test: {
		include: ['src/**/*.test.ts'],
	},
});
