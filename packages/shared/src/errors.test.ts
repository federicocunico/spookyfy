import { expect, test } from 'vitest';
import { ErrorCode } from './errors.js';

test('error codes are stable strings', () => {
  expect(ErrorCode.UsernameTaken).toBe('USERNAME_TAKEN');
});
