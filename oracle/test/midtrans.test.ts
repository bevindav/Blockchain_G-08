import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignature, verifySignature, classify, parseGrossAmount, mockSettle } from '../src/midtrans';

const KEY = 'SB-Mid-server-TEST';

test('signature SHA512(order_id+status_code+gross_amount+serverKey) sesuai dokumentasi Midtrans', () => {
  const sig = computeSignature('DON-001', '200', '100000.00', KEY);
  assert.equal(sig.length, 128);
  assert.ok(verifySignature({ order_id: 'DON-001', status_code: '200', gross_amount: '100000.00', signature_key: sig }, KEY));
});

test('menolak signature yang dimanipulasi (nominal diubah / key salah / kosong)', () => {
  const sig = computeSignature('DON-001', '200', '100000.00', KEY);
  assert.equal(verifySignature({ order_id: 'DON-001', status_code: '200', gross_amount: '999999.00', signature_key: sig }, KEY), false);
  assert.equal(verifySignature({ order_id: 'DON-001', status_code: '200', gross_amount: '100000.00', signature_key: sig }, 'other'), false);
  assert.equal(verifySignature({ order_id: 'DON-001', status_code: '200', gross_amount: '100000.00', signature_key: '' }, KEY), false);
  assert.equal(verifySignature({ order_id: 'DON-001', status_code: '200', gross_amount: '100000.00', signature_key: 'zz' }, KEY), false);
});

test('klasifikasi status transaksi', () => {
  assert.equal(classify({ transaction_status: 'settlement' }), 'success');
  assert.equal(classify({ transaction_status: 'capture', fraud_status: 'accept' }), 'success');
  assert.equal(classify({ transaction_status: 'capture', fraud_status: 'challenge' }), 'pending');
  assert.equal(classify({ transaction_status: 'pending' }), 'pending');
  for (const s of ['deny', 'cancel', 'expire', 'failure', 'refund']) assert.equal(classify({ transaction_status: s }), 'failed');
});

test('parse gross_amount tanpa pecahan', () => {
  assert.equal(parseGrossAmount('100000.00'), 100000n);
  assert.equal(parseGrossAmount('5000'), 5000n);
  assert.throws(() => parseGrossAmount('100.50'));
  assert.throws(() => parseGrossAmount('-1'));
  assert.throws(() => parseGrossAmount('1e9'));
});

test('simulator gateway menghasilkan notifikasi bertanda tangan valid', () => {
  const n = mockSettle('DON-XYZ', 25000n, 'settlement');
  assert.equal(n.gross_amount, '25000.00');
  assert.ok(verifySignature(n));
});
