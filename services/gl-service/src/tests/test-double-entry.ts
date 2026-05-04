/**
 * Test: Double-entry enforcement trigger
 * 1. Create a journal entry with mismatched debits/credits
 * 2. Try to set status to POSTED
 * 3. Confirm the trigger raises an exception
 * 4. Create a balanced entry and confirm it posts successfully
 */
import { PrismaClient } from '.prisma/gl-client';

const prisma = new PrismaClient();

async function main() {
  const tenantId = 'test-double-entry';

  // Ensure a GL account exists for our test
  const account = await prisma.gLAccount.upsert({
    where: { tenantId_code: { tenantId, code: 'TEST-1010' } },
    update: {},
    create: { tenantId, code: 'TEST-1010', name: 'Test Cash', type: 'ASSET', isActive: true },
  });

  const account2 = await prisma.gLAccount.upsert({
    where: { tenantId_code: { tenantId, code: 'TEST-4100' } },
    update: {},
    create: { tenantId, code: 'TEST-4100', name: 'Test Revenue', type: 'REVENUE', isActive: true },
  });

  // TEST 1: Unbalanced entry should be blocked from POSTED
  console.log('TEST 1: Unbalanced entry — expect trigger to block');
  const unbalanced = await prisma.journalEntry.create({
    data: {
      tenantId,
      entryDate: new Date(),
      description: 'Unbalanced test entry',
      source: 'TEST',
      status: 'PENDING_REVIEW',
      lines: {
        create: [
          { glAccountId: account.id, debit: 1000, credit: 0, memo: 'Debit only' },
          { glAccountId: account2.id, debit: 0, credit: 500, memo: 'Half credit' },
        ],
      },
    },
  });

  try {
    await prisma.journalEntry.update({
      where: { id: unbalanced.id },
      data: { status: 'POSTED', postedBy: 'test', postedAt: new Date() },
    });
    console.log('  FAIL — entry was posted (trigger did not fire)');
    process.exitCode = 1;
  } catch (err: any) {
    if (err.message?.includes('debits') && err.message?.includes('do not equal credits')) {
      console.log('  PASS — trigger blocked: ' + err.message.split('\n')[0]);
    } else {
      console.log('  FAIL — unexpected error: ' + err.message);
      process.exitCode = 1;
    }
  }

  // Verify it stayed in PENDING_REVIEW
  const afterFail = await prisma.journalEntry.findUnique({ where: { id: unbalanced.id } });
  console.log(`  Entry status after failed post: ${afterFail?.status}`);
  if (afterFail?.status === 'PENDING_REVIEW') {
    console.log('  PASS — entry remained PENDING_REVIEW');
  } else {
    console.log('  FAIL — entry status changed unexpectedly');
    process.exitCode = 1;
  }

  // TEST 2: Entry with no lines should be blocked
  console.log('\nTEST 2: Entry with no lines — expect trigger to block');
  const noLines = await prisma.journalEntry.create({
    data: {
      tenantId,
      entryDate: new Date(),
      description: 'No lines test entry',
      source: 'TEST',
      status: 'PENDING_REVIEW',
    },
  });

  try {
    await prisma.journalEntry.update({
      where: { id: noLines.id },
      data: { status: 'POSTED', postedBy: 'test', postedAt: new Date() },
    });
    console.log('  FAIL — entry was posted without lines');
    process.exitCode = 1;
  } catch (err: any) {
    if (err.message?.includes('no journal lines')) {
      console.log('  PASS — trigger blocked: ' + err.message.split('\n')[0]);
    } else {
      console.log('  FAIL — unexpected error: ' + err.message);
      process.exitCode = 1;
    }
  }

  // TEST 3: Balanced entry should post successfully
  console.log('\nTEST 3: Balanced entry — expect to post successfully');
  const balanced = await prisma.journalEntry.create({
    data: {
      tenantId,
      entryDate: new Date(),
      description: 'Balanced test entry',
      source: 'TEST',
      status: 'PENDING_REVIEW',
      lines: {
        create: [
          { glAccountId: account.id, debit: 1000, credit: 0, memo: 'Cash in' },
          { glAccountId: account2.id, debit: 0, credit: 1000, memo: 'Revenue' },
        ],
      },
    },
  });

  try {
    await prisma.journalEntry.update({
      where: { id: balanced.id },
      data: { status: 'POSTED', postedBy: 'test', postedAt: new Date() },
    });
    console.log('  PASS — balanced entry posted successfully');
  } catch (err: any) {
    console.log('  FAIL — balanced entry was blocked: ' + err.message);
    process.exitCode = 1;
  }

  // Cleanup
  await prisma.journalLine.deleteMany({ where: { journalEntry: { tenantId } } });
  await prisma.journalEntry.deleteMany({ where: { tenantId } });
  await prisma.gLAccount.deleteMany({ where: { tenantId } });

  await prisma.$disconnect();
  console.log('\nAll double-entry tests complete.');
}

main();
