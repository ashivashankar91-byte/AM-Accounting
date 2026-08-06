import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { safeFilenameSegment, tbCsvCell, toTrialBalanceCsv } from '../src/http/routes';
import type { TrialBalanceRow } from '../src/application/trial-balance-service';

// Pure CSV-serialization unit tests for the Trial Balance export -- no
// database, no HTTP. Covers exactly the CSV-safety requirements from the
// export checkpoint: quoting, formula-injection protection, decimal
// precision, and filename normalization.

function row(overrides: Partial<TrialBalanceRow>): TrialBalanceRow {
  return {
    accountId: 'acct-1',
    accountCode: '1000',
    accountName: 'Cash',
    accountType: 'ASSET',
    normalBalance: 'DEBIT',
    priorBalance: 0,
    currentAmount: 0,
    endingBalance: 0,
    debitBalance: 0,
    creditBalance: 0,
    ...overrides,
  };
}

describe('tbCsvCell', () => {
  it('quotes a value containing a comma', () => {
    expect(tbCsvCell('Cash, Operating', false)).toBe('"Cash, Operating"');
  });

  it('quotes and escapes a value containing a double quote', () => {
    expect(tbCsvCell('Say "hi"', false)).toBe('"Say ""hi"""');
  });

  it('quotes a value containing an embedded newline', () => {
    expect(tbCsvCell('line1\nline2', false)).toBe('"line1\nline2"');
    expect(tbCsvCell('line1\r\nline2', false)).toBe('"line1\r\nline2"');
  });

  it('protects a formula-injection payload starting with = when protectFormulas is true', () => {
    expect(tbCsvCell('=SUM(A1:A9)', true)).toBe("'=SUM(A1:A9)");
  });

  it('protects payloads starting with +, -, and @ when protectFormulas is true', () => {
    expect(tbCsvCell('+1+1', true)).toBe("'+1+1");
    expect(tbCsvCell('-cmd|calc', true)).toBe("'-cmd|calc");
    expect(tbCsvCell('@SUM(1)', true)).toBe("'@SUM(1)");
  });

  it('does NOT protect a leading "-" when protectFormulas is false (legitimate negative money)', () => {
    expect(tbCsvCell('-500.00', false)).toBe('-500.00');
  });

  it('leaves an ordinary account code/name untouched', () => {
    expect(tbCsvCell('1000', true)).toBe('1000');
    expect(tbCsvCell('Cash — Operating', true)).toBe('Cash — Operating');
  });

  it('renders null/undefined as an empty cell', () => {
    expect(tbCsvCell(null, false)).toBe('');
    expect(tbCsvCell(undefined, false)).toBe('');
  });
});

describe('toTrialBalanceCsv', () => {
  it('emits the approved stable 8-column header', () => {
    const csv = toTrialBalanceCsv([]);
    expect(csv).toBe('Account,Name,Type,Opening,Activity,Ending,Debit,Credit');
  });

  it('preserves 2-decimal precision for every money field, matching the on-screen values exactly (no browser recalculation)', () => {
    const csv = toTrialBalanceCsv([
      row({ accountCode: '1000', accountName: 'Cash', accountType: 'ASSET', priorBalance: 0, currentAmount: 500, endingBalance: 500, debitBalance: 500, creditBalance: 0 }),
    ]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe('1000,Cash,ASSET,0.00,500.00,500.00,500.00,0.00');
  });

  it('preserves a legitimate negative Activity value as a real signed number, not formula-escaped', () => {
    const csv = toTrialBalanceCsv([
      row({ accountCode: '2000', accountName: 'Accounts Payable', accountType: 'LIABILITY', priorBalance: 0, currentAmount: -100, endingBalance: -100, debitBalance: 0, creditBalance: 100 }),
    ]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toContain(',-100.00,');
    expect(dataLine).not.toContain("'-100.00");
  });

  it('protects an account name that looks like a spreadsheet formula (real Chart-of-Accounts free-text risk)', () => {
    const csv = toTrialBalanceCsv([row({ accountCode: '9999', accountName: '=HYPERLINK("http://evil.example")' })]);
    const dataLine = csv.split('\r\n')[1];
    // The cell also contains double quotes, so it is additionally
    // CSV-quoted with internal quotes doubled -- both protections apply
    // together, correctly.
    expect(dataLine).toContain('"\'=HYPERLINK(""http://evil.example"")"');
    expect(dataLine.startsWith('9999,"\'=HYPERLINK')).toBe(true);
  });

  it('quotes an account name containing a comma without corrupting column alignment', () => {
    const csv = toTrialBalanceCsv([row({ accountCode: '1200', accountName: 'Accounts Receivable, Trade' })]);
    const dataLine = csv.split('\r\n')[1];
    const cells = dataLine.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);
    expect(dataLine).toContain('"Accounts Receivable, Trade"');
    expect(cells?.length).toBe(8);
  });

  it('uses CRLF row separators', () => {
    const csv = toTrialBalanceCsv([row({}), row({ accountCode: '2000' })]);
    expect(csv.split('\r\n').length).toBe(3); // header + 2 rows
  });
});

describe('safeFilenameSegment', () => {
  it('passes through an ordinary entity code unchanged', () => {
    expect(safeFilenameSegment('01')).toBe('01');
  });

  it('passes through an asOf period unchanged', () => {
    expect(safeFilenameSegment('2026-02')).toBe('2026-02');
  });

  it('strips characters that could break a Content-Disposition header (quotes, CRLF, path separators)', () => {
    expect(safeFilenameSegment('01"; evil="x')).toBe('01___evil__x');
    expect(safeFilenameSegment('01\r\nSet-Cookie: a=b')).not.toMatch(/[\r\n]/);
    expect(safeFilenameSegment('../../etc/passwd')).not.toContain('/');
  });

  it('bounds the segment length', () => {
    expect(safeFilenameSegment('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
