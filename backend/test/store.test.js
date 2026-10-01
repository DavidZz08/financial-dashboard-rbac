const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');

describe('store', () => {
  test('watchlist add/update/remove keeps metadata consistent', () => {
    const s = createStore();
    const item = s.watchlist.add('bitcoin', 'Ana', { note: 'n' });
    assert.equal(item.addedBy, 'Ana');
    const upd = s.watchlist.update('bitcoin', { note: 'm' });
    assert.equal(upd.note, 'm');
    assert.equal(upd.addedBy, 'Ana');
    assert.equal(s.watchlist.remove('bitcoin'), true);
    assert.equal(s.watchlist.remove('bitcoin'), false);
  });

  test('thresholds are returned as copies (callers cannot mutate state)', () => {
    const s = createStore();
    s.thresholds().volatilityAlertPct = 99;
    assert.equal(s.thresholds().volatilityAlertPct, 5);
    assert.equal(s.setVolatilityAlertPct(8), 5);
  });

  test('audit ids are monotonic and merged newest-first across buffers', () => {
    const s = createStore();
    s.audit({ actor: 'a', role: 'admin', action: 'x' });
    s.audit({ actor: 'b', role: 'viewer', action: 'y', outcome: 'denied' });
    s.audit({ actor: 'c', role: 'admin', action: 'z' });
    assert.deepEqual(s.auditEntries().map((e) => e.action), ['z', 'y', 'x']);
    assert.equal(s.auditEntries(2).length, 2);
  });
});
