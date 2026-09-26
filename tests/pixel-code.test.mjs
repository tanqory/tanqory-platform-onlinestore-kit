/**
 * The `analytics` binding the pixel wizard's snippets need (see src/pixel-code.ts).
 * Pure function — runs on the TypeScript source directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

import { wrapPixelCode } from '../src/pixel-code.ts'

const META = `analytics.subscribe("checkout_completed", (event) => {
  fbq('track', 'Purchase', {
    value: event.data.checkout?.totalPrice?.amount,
    currency: event.data.checkout?.totalPrice?.currencyCode,
  });
});`

function page() {
  const calls = []
  const subs = {}
  const ctx = vm.createContext({
    fbq: (...a) => calls.push(a),
  })
  ctx.window = ctx
  ctx.tqAnalytics = { subscribe: (name, cb) => ((subs[name] = subs[name] || []).push(cb), () => {}) }
  return { ctx, calls, subs }
}

test('an unwrapped wizard snippet throws (no global `analytics`)', () => {
  const { ctx } = page()
  assert.throws(() => vm.runInContext(META, ctx), /analytics is not defined/)
})

test('a wrapped snippet subscribes on the bus and receives the purchase in the order currency', () => {
  for (const [cur, total] of [['USD', 105], ['EUR', 99.9], ['THB', 3590], ['JPY', 15000]]) {
    const { ctx, calls, subs } = page()
    vm.runInContext(wrapPixelCode(META), ctx)
    assert.equal(subs.checkout_completed.length, 1)
    subs.checkout_completed[0]({ data: { checkout: { totalPrice: { amount: total, currencyCode: cur } } } })
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['track', 'Purchase', { value: total, currency: cur }]])
  }
})

test('wrapping adds no global named `analytics`', () => {
  const { ctx } = page()
  vm.runInContext(wrapPixelCode(META), ctx)
  assert.equal(vm.runInContext('typeof analytics', ctx), 'undefined')
})
