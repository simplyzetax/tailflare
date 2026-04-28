import { describe, expect, it, vi } from 'vitest';

vi.mock('./tailscale.wasm', () => ({ default: new ArrayBuffer(8) }));
vi.mock('./wasm_exec.js', () => ({}));

import { createIPN } from './index';
import { createIPN as directCreateIPN } from './ipn';

describe('package exports', () => {
	it('re-exports createIPN from the IPN module', () => {
		expect(createIPN).toBe(directCreateIPN);
	});
});
