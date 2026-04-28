import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tanstackRouter({
			target: 'react',
			autoCodeSplitting: true,
		}),
		react(),
		tailwindcss(),
	],
	server: {
		port: 5173,
		proxy: {
			'/rpc': 'http://localhost:8787',
			'/api': 'http://localhost:8787',
			'/scalar': 'http://localhost:8787',
		},
	},
});