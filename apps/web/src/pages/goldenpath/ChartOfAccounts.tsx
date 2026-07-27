import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const NORMAL_BALANCE: Record<string, string> = {
  ASSET: 'DR', EXPENSE: 'DR', LIABILITY: 'CR', EQUITY: 'CR', REVENUE: 'CR',
};

// FINAL-R0 Golden Path step 5: maintain/seed Chart of Accounts, wired to the
// real coa-service account-routes (S210) through the real gateway.
export default function ChartOfAccountsGoldenPath() {
  const { legalEntityId } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ accountNumber: '', name: '', type: 'EXPENSE', postable: true });

  async function refresh() {
    if (!legalEntityId) return;
    try {
      const { accounts } = await goldenPathApi.listAccounts(legalEntityId);
      setAccounts(accounts);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { refresh(); }, [legalEntityId]);

  if (!legalEntityId) {
    return (
      <div style={{ margin: 40 }}>
        <p>No legal entity selected.</p>
        <Link to="/golden-path/select-entity">Select a legal entity</Link>
      </div>
    );
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await goldenPathApi.createAccount({
        entityId: legalEntityId!,
        accountNumber: form.accountNumber,
        name: form.name,
        type: form.type,
        normalBalance: NORMAL_BALANCE[form.type],
        postable: form.postable,
      });
      setForm({ accountNumber: '', name: '', type: 'EXPENSE', postable: true });
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Chart of Accounts</h1>
      {error && <p data-testid="coa-error" style={{ color: '#b91c1c' }}>{error}</p>}

      <form onSubmit={createAccount} data-testid="coa-create-form" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          data-testid="coa-account-number"
          placeholder="Account #"
          value={form.accountNumber}
          onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
          required
          pattern="\d{5}"
        />
        <input
          data-testid="coa-account-name"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <select data-testid="coa-account-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label>
          <input
            type="checkbox"
            checked={form.postable}
            onChange={(e) => setForm({ ...form, postable: e.target.checked })}
          /> Postable
        </label>
        <button data-testid="coa-create-submit" type="submit">Add Account</button>
      </form>

      <table data-testid="coa-account-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={{ textAlign: 'left' }}>#</th><th style={{ textAlign: 'left' }}>Name</th><th>Type</th><th>Postable</th><th>Balance</th></tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{a.accountNumber}</td>
              <td>{a.name}</td>
              <td>{a.type}</td>
              <td>{a.postable ? 'Yes' : 'No'}</td>
              <td>{a.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button data-testid="coa-continue" style={{ marginTop: 24 }} onClick={() => navigate('/golden-path/journal')}>
        Continue to Journal Entry
      </button>
    </div>
  );
}
