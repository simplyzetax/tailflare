import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { routeTree } from './routeTree.gen';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
	throw new Error('Root element not found');
}

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

const router = createRouter({
	routeTree,
	defaultPreload: 'intent',
	context: { queryClient },
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
