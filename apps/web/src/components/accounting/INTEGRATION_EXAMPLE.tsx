/**
 * INTEGRATION EXAMPLE — Complete workflow using all 8 accounting components
 *
 * This file demonstrates how to compose all 8 components in a real page.
 * Copy this pattern when building accounting workflows (WF-A001 through WF-A010).
 */

import { useState } from 'react';
import {
  GLAccountLookup,
  JournalEntryTable,
  VendorLookup,
  AgingDisplay,
  PeriodSelector,
  FinancialStatementViewer,
  ActionBar,
  AuditTrailViewer,
} from './index';
import type {
  GLAccountType,
  JournalLine,
  Vendor,
  Period,
  FinancialStatementData,
  ActionDefinition,
  AuditEntry,
} from './index';

/**
 * Example: Journal Entry with GL lookup, vendor AP, and audit trail
 */
export function ExampleJournalEntryPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [journalLines, setJournalLines] = useState<JournalLine[]>([
    { id: '1', accountCode: '', debit: 0, credit: 0 },
  ]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([
    {
      timestamp: new Date(),
      userId: 'user@company.com',
      action: 'Created journal entry',
      beforeValue: null,
      afterValue: { status: 'DRAFT' },
    },
  ]);

  const handleSave = () => {
    console.log('Saving journal entry...', {
      period: selectedPeriod,
      lines: journalLines,
    });

    setAuditEntries([
      ...auditEntries,
      {
        timestamp: new Date(),
        userId: 'user@company.com',
        action: 'Saved journal entry',
        beforeValue: { status: 'DRAFT' },
        afterValue: { status: 'SAVED', lineCount: journalLines.length },
      },
    ]);
  };

  const handlePost = () => {
    console.log('Posting journal entry...');

    setAuditEntries([
      ...auditEntries,
      {
        timestamp: new Date(),
        userId: 'user@company.com',
        action: 'Posted journal entry',
        beforeValue: { status: 'SAVED' },
        afterValue: { status: 'POSTED', postedAt: new Date().toISOString() },
      },
    ]);
  };

  const actions: ActionDefinition[] = [
    {
      label: 'Save',
      onClick: handleSave,
      variant: 'primary',
      shortcut: 'Ctrl+S',
    },
    {
      label: 'Post',
      onClick: handlePost,
      variant: 'primary',
      shortcut: 'Ctrl+P',
      disabled: journalLines.filter((l) => l.accountCode).length < 2,
    },
    {
      label: 'Cancel',
      onClick: () => window.history.back(),
      variant: 'secondary',
      shortcut: 'Escape',
    },
  ];

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Journal Entry</h1>
        <p className="text-sm text-gray-600 mt-1">Create and post GL journal entries</p>
      </div>

      {/* Period Selection */}
      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Period</label>
        <PeriodSelector value={selectedPeriod} onChange={setSelectedPeriod} />
      </div>

      {/* GL Account Lookup */}
      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Header GL Account (Optional)
        </label>
        <GLAccountLookup
          value={selectedAccount}
          onChange={(code, account) => {
            setSelectedAccount(code);
            console.log('Selected account:', account);
          }}
        />
      </div>

      {/* Vendor Lookup for AP context */}
      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Vendor (for AP Reference)
        </label>
        <VendorLookup
          value={selectedVendor}
          onChange={(code, vendor) => {
            setSelectedVendor(code);
            console.log('Selected vendor:', vendor);
          }}
        />
      </div>

      {/* Journal Entry Table */}
      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Journal Lines
        </label>
        <JournalEntryTable lines={journalLines} onChange={setJournalLines} />
      </div>

      {/* Audit Trail */}
      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-3">
          Audit Trail
        </label>
        <AuditTrailViewer entries={auditEntries} />
      </div>

      {/* Action Bar */}
      <ActionBar actions={actions} hints={['Ctrl+S: Save', 'Ctrl+P: Post', 'Escape: Cancel']} />
    </div>
  );
}

/**
 * Example: AP Aging Report with vendor lookup
 */
export function ExampleAPAgingReportPage() {
  const [selectedVendor, setSelectedVendor] = useState('');

  // Mock aging data
  const mockAgingData = {
    current: 5000,
    days30: 3000,
    days60: 1500,
    days90: 500,
    over90: 200,
    total: 10200,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Accounts Payable Aging</h1>
        <p className="text-sm text-gray-600 mt-1">Vendor aging analysis</p>
      </div>

      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Filter by Vendor</label>
        <VendorLookup value={selectedVendor} onChange={(code) => setSelectedVendor(code)} />
      </div>

      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-3">Aging Summary</label>
        <AgingDisplay
          current={mockAgingData.current}
          days30={mockAgingData.days30}
          days60={mockAgingData.days60}
          days90={mockAgingData.days90}
          over90={mockAgingData.over90}
          total={mockAgingData.total}
        />
      </div>
    </div>
  );
}

/**
 * Example: Financial Statement with drill-down
 */
export function ExampleFinancialStatementPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('');

  const mockFsData: FinancialStatementData = {
    lineAmounts: {
      ASSETS: 250000,
      'CURRENT-ASSETS': 150000,
      '1000-CASH': 50000,
      '1200-AR': 100000,
      'FIXED-ASSETS': 100000,
      '1500-PPE': 100000,
      LIABILITIES: 100000,
      'CURRENT-LIAB': 80000,
      '2000-AP': 80000,
      'LT-LIAB': 20000,
      EQUITY: 150000,
      'RETAINED-EARNINGS': 150000,
    },
    departmentAmounts: {},
  };

  const handleDrillDown = (lineCode: string, transactions: any[]) => {
    console.log(`Drilling down: ${lineCode}`, transactions);
    // In real app, open detail panel or modal with transactions
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Balance Sheet</h1>
        <p className="text-sm text-gray-600 mt-1">As of month-end</p>
      </div>

      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Period</label>
        <PeriodSelector value={selectedPeriod} onChange={setSelectedPeriod} />
      </div>

      <div className="bg-white border border-gray-300 rounded-lg p-4">
        <FinancialStatementViewer data={mockFsData} onDrillDown={handleDrillDown} />
      </div>
    </div>
  );
}

/**
 * Example: Complete dashboard with all components
 */
export default function AccountingDashboard() {
  const [activeTab, setActiveTab] = useState<'journal' | 'aging' | 'fs'>('journal');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b border-gray-300">
          <button
            onClick={() => setActiveTab('journal')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'journal'
                ? 'border-blue-600 text-brand'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Journal Entry
          </button>
          <button
            onClick={() => setActiveTab('aging')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'aging'
                ? 'border-blue-600 text-brand'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            AP Aging
          </button>
          <button
            onClick={() => setActiveTab('fs')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'fs'
                ? 'border-blue-600 text-brand'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Financial Statements
          </button>
        </div>

        {/* Content */}
        {activeTab === 'journal' && <ExampleJournalEntryPage />}
        {activeTab === 'aging' && <ExampleAPAgingReportPage />}
        {activeTab === 'fs' && <ExampleFinancialStatementPage />}
      </div>
    </div>
  );
}
