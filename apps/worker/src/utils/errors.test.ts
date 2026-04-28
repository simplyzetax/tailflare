import { describe, expect, it, vi } from 'vitest';

import { ApiError } from './errors';

describe('ApiError', () => {
	it('renders JSON responses with status and content type', async () => {
		const error = new ApiError('errors.test', 'Test error', 9001, 418);
		const response = error.toResponse();

		expect(response.status).toBe(418);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expect(await response.json()).toMatchObject({
			errorCode: 'errors.test',
			errorMessage: 'Test error',
			numericErrorCode: 9001,
			originatingService: 'tailflare',
		});
	});

	it('substitutes message variables and tracks service overrides', () => {
		const error = new ApiError('errors.test', 'Failed {0} for {1}', 9001, 400)
			.with('login', 'user')
			.originatingService('auth');

		expect(error.getMessage()).toBe('Failed login for user');
		expect(error.shortenedError()).toBe('errors.test - Failed {0} for {1}');
		expect(error.response.originatingService).toBe('auth');
	});

	it('applies response metadata to a Hono context-like object', () => {
		const status = vi.fn();
		const headers = new Headers();
		const error = new ApiError('errors.test', 'Test error', 9001, 409);

		const body = error.apply({ res: { headers }, status } as never);

		expect(status).toHaveBeenCalledWith(409);
		expect(headers.get('Content-Type')).toBe('application/json');
		expect(headers.get('X-Epic-Error-Code')).toBe('9001');
		expect(headers.get('X-Epic-Error-Name')).toBe('errors.test');
		expect(body.errorMessage).toBe('Test error');
	});

	it('throws an HTTP exception with the serialized error response', async () => {
		const error = new ApiError('errors.test', 'Test error', 9001, 403);

		try {
			error.throwHttpException();
		} catch (caught) {
			expect(caught).toHaveProperty('status', 403);
			const response = (caught as { res: Response }).res;
			expect(response.headers.get('X-Epic-Error-Code')).toBe('9001');
			expect(await response.json()).toMatchObject({ errorCode: 'errors.test' });
		}
	});

	it('appends development messages only in development mode', () => {
		const error = new ApiError('errors.test', 'Test error', 9001, 500);

		expect(error.devMessage('details', 'false').response.errorMessage).toBe('Test error');
		expect(error.devMessage('details', 'true').response.errorMessage).toBe('Test error(Dev: -details-)');
	});
});
