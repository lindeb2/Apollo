import { describe, expect, it } from 'vitest';
import { matchesOidcBootstrapRule } from '../oidcBootstrap.js';

describe('matchesOidcBootstrapRule', () => {
  it('allows any claim set when no rule is configured', () => {
    expect(matchesOidcBootstrapRule({ email: 'alice@example.com' }, '')).toBe(true);
  });

  it('matches top-level claim=value rules', () => {
    expect(matchesOidcBootstrapRule(
      { email: 'alice@example.com', sub: 'alice' },
      'email=alice@example.com'
    )).toBe(true);
  });

  it('matches nested claim paths', () => {
    expect(matchesOidcBootstrapRule(
      { realm_access: { roles: ['user', 'apollo-admin'] } },
      'realm_access.roles=apollo-admin'
    )).toBe(true);
  });

  it('matches provider permissions arrays by id', () => {
    expect(matchesOidcBootstrapRule(
      {
        permissions: [
          { id: 'apollo-editor', scope: 'write' },
          { id: 'nyckeln-under-dormattan', scope: null },
        ],
      },
      'permissions.id=nyckeln-under-dormattan'
    )).toBe(true);
  });

  it('matches provider permissions arrays by scope', () => {
    expect(matchesOidcBootstrapRule(
      {
        permissions: [
          { id: 'apollo-editor', scope: 'write' },
          { id: 'apollo-reader', scope: 'read' },
        ],
      },
      'permissions.scope=write'
    )).toBe(true);
  });

  it('supports exact scalar fallback matching without a claim path', () => {
    expect(matchesOidcBootstrapRule(
      { email: 'alice@example.com', preferred_username: 'alice' },
      'alice@example.com'
    )).toBe(true);
  });

  it('rejects non-matching claim requirements', () => {
    expect(matchesOidcBootstrapRule(
      { email: 'bob@example.com', groups: ['users'] },
      'email=alice@example.com'
    )).toBe(false);
  });
});
