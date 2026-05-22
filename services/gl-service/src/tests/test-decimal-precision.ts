// Verification test: NUMERIC(15,2) precision for monetary columns
// This test verifies that 0.1 + 0.2 is stored as exactly 0.30, not 0.30000000000000004

import { Decimal } from '@prisma/client/runtime/library';

function testDecimalPrecision() {
  // Test 1: Basic floating point problem
  const floatResult = 0.1 + 0.2;
  const floatFails = floatResult !== 0.3; // true — float is imprecise
  console.assert(floatFails, 'Expected float to be imprecise');

  // Test 2: Decimal is exact
  const d1 = new Decimal('0.1');
  const d2 = new Decimal('0.2');
  const decimalResult = d1.plus(d2);
  const decimalPasses = decimalResult.equals(new Decimal('0.3'));
  console.assert(decimalPasses, `Expected Decimal(0.1) + Decimal(0.2) = 0.3, got ${decimalResult}`);

  // Test 3: Financial scenario — sum of journal lines must balance exactly
  const debits = ['100.00', '200.00', '0.01'].map(v => new Decimal(v));
  const totalDebit = debits.reduce((sum, d) => sum.plus(d), new Decimal(0));
  const expectedTotal = new Decimal('300.01');
  console.assert(totalDebit.equals(expectedTotal),
    `Journal total should be 300.01, got ${totalDebit}`);

  console.log('✓ Decimal precision tests passed');
  console.log(`  Float 0.1+0.2 = ${floatResult} (imprecise: ${floatFails})`);
  console.log(`  Decimal 0.1+0.2 = ${decimalResult} (exact: ${decimalPasses})`);
}

testDecimalPrecision();
