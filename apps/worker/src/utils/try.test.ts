import { describe, expect, it } from 'vitest';

import { tryCatch } from './try';

describe('tryCatch', () => {
	it('returns the resolved value', async () => {
		await expect(tryCatch(async () => 'ok')).resolves.toBe('ok');
	});

	it('returns undefined when the callback throws', async () => {
		await expect(
			tryCatch(async () => {
				throw new Error('boom');
			}),
		).resolves.toBeUndefined();
	});
});
