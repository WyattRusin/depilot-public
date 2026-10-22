import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGoogleUser } from '../lib/server/auth.ts';

test('only Google accounts get in', () => {
  assert.equal(isGoogleUser({ app_metadata: { provider: 'google', providers: ['google'] }, identities: [] }), true);
  assert.equal(isGoogleUser({ app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email' }] }), false);
  assert.equal(isGoogleUser({ app_metadata: { provider: 'email', providers: ['email', 'google'] }, identities: [] }), true);
  assert.equal(isGoogleUser({ app_metadata: {}, identities: [] }), false);
});

import { isAdminUser } from '../lib/server/auth.ts';

test('admin only when the email GOOGLE vouched for is on the list', () => {
  const g = (email, extra = {}) => ({
    app_metadata: { provider: 'google', providers: ['google'] }, email: 'whatever@x.com',
    identities: [{ provider: 'google', identity_data: { email, email_verified: true, ...extra } }],
  });
  const list = ['admin@example.com'];
  assert.equal(isAdminUser(g('admin@example.com'), list), true);
  assert.equal(isAdminUser(g(' Admin@Example.com '), list), true, 'case and spaces ignored');
  assert.equal(isAdminUser(g('someone@example.com'), list), false);
  assert.equal(isAdminUser(g('admin@example.com', { email_verified: false }), list), false, 'unverified Google email');
  assert.equal(isAdminUser({ ...g('someone@example.com'), email: 'admin@example.com' }, list), false,
    'changing the account email to the admin\'s does not make you admin');
  assert.equal(isAdminUser({ app_metadata: { provider: 'email', providers: ['email'] }, identities: [], email: 'admin@example.com' }, list), false, 'must be Google');
  assert.equal(isAdminUser(null, list), false);
  assert.equal(isAdminUser(g('admin@example.com'), []), false);
});
