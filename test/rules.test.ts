import { describe, test, expect } from 'bun:test';
import { evaluateRule } from '../src/lib/rules';

describe('Security Rules Evaluator', () => {
  const adminCtx = {
    user: { id: 'u_123', email: 'admin@example.com', role: 'admin' },
    doc: null,
    request: null,
  };

  const userCtx = {
    user: { id: 'u_456', email: 'user@example.com', role: 'user' },
    doc: { userId: 'u_456' },
    request: null,
  };

  const anonCtx = {
    user: { id: null, email: null, role: null },
    doc: null,
    request: null,
  };

  test('literals true and false', () => {
    expect(evaluateRule('true', anonCtx)).toBe(true);
    expect(evaluateRule('false', anonCtx)).toBe(false);
  });

  test('user role comparison', () => {
    expect(evaluateRule("user.role == 'admin'", adminCtx)).toBe(true);
    expect(evaluateRule("user.role == 'admin'", userCtx)).toBe(false);
    expect(evaluateRule("user.role == 'admin'", anonCtx)).toBe(false);
  });

  test('doc owner comparison', () => {
    expect(evaluateRule('doc.userId == user.id', userCtx)).toBe(true);
    expect(evaluateRule('doc.userId == user.id', adminCtx)).toBe(false);
  });

  test('logical OR and AND with precedence', () => {
    expect(evaluateRule("doc.userId == user.id || user.role == 'admin'", adminCtx)).toBe(true);
    expect(evaluateRule("doc.userId == user.id || user.role == 'admin'", userCtx)).toBe(true);
    expect(evaluateRule("doc.userId == user.id || user.role == 'admin'", anonCtx)).toBe(false);

    expect(evaluateRule("user.role == 'user' && doc.userId == user.id", userCtx)).toBe(true);
    expect(evaluateRule("user.role == 'user' && doc.userId == user.id", adminCtx)).toBe(false);
  });

  test('negation', () => {
    expect(evaluateRule('!false', anonCtx)).toBe(true);
    expect(evaluateRule('!(user.role == "admin")', userCtx)).toBe(true);
  });

  test('null and undefined checks', () => {
    expect(evaluateRule('user.id != null', userCtx)).toBe(true);
    expect(evaluateRule('user.id == null', anonCtx)).toBe(true);
  });

  test('parentheses grouping', () => {
    expect(evaluateRule('(true || false) && false', anonCtx)).toBe(false);
    expect(evaluateRule('true || (false && false)', anonCtx)).toBe(true);
  });

  test('invalid syntax returns false without throwing', () => {
    expect(evaluateRule('user.role === "admin"', userCtx)).toBe(false);
    expect(evaluateRule('foo (', userCtx)).toBe(false);
  });
});
