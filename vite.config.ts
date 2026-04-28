/// <reference types="vitest/config" />

import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	plugins: [react(), tailwindcss(), ...(mode === 'test' ? [] : [cloudflare()])],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
}));
