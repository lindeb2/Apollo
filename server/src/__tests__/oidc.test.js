import { describe, expect, it } from 'vitest';
import { resolveStoredIssuer } from '../oidc.js';

describe('resolveStoredIssuer', () => {
  it('prefers the configured public issuer when the raw issuer matches the internal issuer', () => {
    expect(resolveStoredIssuer('http://localhost:9400')).toBe('http://localhost:9400');
  });

  it('normalizes the internal mock issuer to the public issuer for stable local identities', () => {
    expect(resolveStoredIssuer('http://oidc-mock:9400')).toBe('http://localhost:9400');
  });
});
