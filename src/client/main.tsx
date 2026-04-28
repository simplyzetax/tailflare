import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
	throw new Error('Root element not found');
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: (failureCount, error) => {
				if (isUnauthorizedError(error)) return false;
				return failureCount < 2;
			},
		},
	},
});

function isUnauthorizedError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		'status' in error &&
		(error as { code?: unknown }).code === 'UNAUTHORIZED' &&
		(error as { status?: unknown }).status === 401
	);
}

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
