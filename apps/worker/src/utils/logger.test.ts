import { afterEach, describe, expect, it, vi } from 'vitest';

import { Logger } from './logger';

describe('Logger', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('writes structured and pretty log lines', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-28T00:00:00.000Z'));
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const logger = new Logger('api', true);

		logger.info('ready', { requestId: 'req-1' });

		expect(log).toHaveBeenCalledTimes(2);
		expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual({
			timestamp: '2026-04-28T00:00:00.000Z',
			level: 'info',
			prefix: 'API',
			message: 'ready',
			requestId: 'req-1',
		});
		expect(log.mock.calls[1]?.[0]).toContain('[INFO]');
		expect(log.mock.calls[1]?.[0]).toContain('API');
		expect(log.mock.calls[1]?.[0]).toContain('ready');
	});

	it('can disable pretty log lines', () => {
		const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const logger = new Logger('worker', false);

		logger.error('failed');

		expect(log).toHaveBeenCalledTimes(1);
		expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
			level: 'error',
			message: 'failed',
			prefix: 'WORKER',
		});
	});
});
