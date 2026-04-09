'use client';
import { useState } from 'react';
import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';

const users = [
  { name: 'John Doe', wallet: '0x8F3a...4c2D', kyc: 'Verified', tier: 'Premium', seed: 'Elite', mice: 'Licensed', refs: 47, joined: 'Jan 15, 2025' },
  { name: 'Maria Silva', wallet: '0x2A4b...8E1F', kyc: 'Verified', tier: 'Creator', seed: 'Pro', mice: 'Licensed', refs: 34, joined: 'Feb 03, 2025' },
  { name: 'David Chen', wallet: '0x7D2c...5B3E', kyc: 'Pending', tier: 'Basic', seed: 'Standard', mice: 'None', refs: 12, joined: 'Mar 10, 2025' },
  { name: 'Emma Watson', wallet: '0x4E1d...9A7F', kyc: 'Verified', tier: 'Creator', seed: 'Pro Advanced', mice: 'Licensed', refs: 28, joined: 'Jan 28, 2025' },
  { name: 'Alex Kumar', wallet: '0x9B5e...3D6C', kyc: 'Rejected', tier: 'Basic', seed: 'Basic', mice: 'None', refs: 5, joined: 'Mar 22, 2025' },
];

const kycBadge = (v: string) => {
  const map: Record<string, 'verified' | 'pending' | 'draft'> = { Verified: 'verified', Pending: 'pending', Rejected: 'draft' };
  return <Badge variant={map[v] || 'draft'}>{v}</Badge>;
};

const columns = [
  { key: 'name', label: 'User' },
  { key: 'wallet', label: 'Wallet', className: 'td-mono' },
  { key: 'kyc', label: 'KYC', render: kycBadge },
  { key: 'tier', label: 'Creator Tier', render: (v: string) => <Badge variant="gold">{v}</Badge> },
  { key: 'seed', label: 'SEED', render: (v: string) => <Badge variant="active">{v}</Badge> },
  { key: 'mice', label: 'MICE', render: (v: string) => v === 'Licensed' ? <Badge variant="purple">{v}</Badge> : <span style={{ color: 'var(--muted)' }}>{v}</span> },
  { key: 'refs', label: 'F1 Refs', className: 'td-gold' },
  { key: 'joined', label: 'Joined' },
];

export default function UsersPage() {
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<any>(null);

  return (
    <>
      <SectionHead title="User Management — Cross-Platform" action={<button className="btn btn-outline btn-sm">Export CSV</button>} />
      <DataTable
        columns={columns}
        data={users}
        searchPlaceholder="Search by name, wallet, email..."
        onRowClick={(row) => { setSelected(row); setModal(true); }}
      />
      <Modal isOpen={modal} onClose={() => setModal(false)} title="User Profile — Cross-Platform View"
        footer={<><button className="btn btn-outline" onClick={() => setModal(false)}>Close</button><button className="btn btn-primary">Save Changes</button></>}
      >
        {selected && (
          <div className="user-modal-grid">
            <div className="user-modal-section">
              <div className="user-section-title">Identity</div>
              <div className="user-info-row"><span className="user-info-label">Wallet</span><span className="user-info-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{selected.wallet}</span></div>
              <div className="user-info-row"><span className="user-info-label">Email</span><span className="user-info-value">{selected.name.toLowerCase().replace(' ', '@')}example.com</span></div>
              <div className="user-info-row"><span className="user-info-label">KYC</span><span className="user-info-value">{kycBadge(selected.kyc)}</span></div>
              <div className="user-info-row"><span className="user-info-label">Role</span><span className="user-info-value">Creator</span></div>
              <div className="user-info-row"><span className="user-info-label">Status</span><span className="user-info-value"><Badge variant="active">Active</Badge></span></div>
              <div className="user-modal-buttons">
                <button className="btn btn-danger btn-sm">Ban User</button>
                <button className="btn btn-outline btn-sm">Suspend</button>
              </div>
            </div>
            <div className="user-modal-section">
              <div className="user-section-title">Financial (Apps)</div>
              <div className="user-info-row"><span className="user-info-label">SEED Package</span><span className="user-info-value">{selected.seed}</span></div>
              <div className="user-info-row"><span className="user-info-label">Vesting %</span><span className="user-info-value">15% unlocked</span></div>
              <div className="user-info-row"><span className="user-info-label">MICE License</span><span className="user-info-value">{selected.mice === 'Licensed' ? <Badge variant="purple">Licensed</Badge> : 'None'}</span></div>
              <div className="user-info-row"><span className="user-info-label">Staked MIC</span><span className="user-info-value td-gold">5.75M</span></div>
              <div className="user-info-row"><span className="user-info-label">F1 Referrals</span><span className="user-info-value">{selected.refs}</span></div>
              <div className="user-info-row"><span className="user-info-label">Commission</span><span className="user-info-value td-gold">$28,400</span></div>
              <div className="user-info-row"><span className="user-info-label">MFP-NFT</span><span className="user-info-value">50</span></div>
              <div className="user-info-row"><span className="user-info-label">MIC Balance</span><span className="user-info-value td-gold">847,500</span></div>
            </div>
            <div className="user-modal-section" style={{ borderRight: 'none', paddingRight: 0 }}>
              <div className="user-section-title">Community (World)</div>
              <div className="user-info-row"><span className="user-info-label">Creator Tier</span><span className="user-info-value"><Badge variant="gold">{selected.tier}</Badge></span></div>
              <div className="user-info-row"><span className="user-info-label">Points</span><span className="user-info-value">3,240</span></div>
              <div className="user-info-row"><span className="user-info-label">Content Created</span><span className="user-info-value">12</span></div>
              <div className="user-info-row"><span className="user-info-label">Challenges</span><span className="user-info-value">4</span></div>
              <div className="user-info-row"><span className="user-info-label">Mod Flags</span><span className="user-info-value">0</span></div>
              <div className="user-info-row"><span className="user-info-label">SOPHIA Chats</span><span className="user-info-value">127</span></div>
              <div className="user-info-row"><span className="user-info-label">Joined</span><span className="user-info-value">{selected.joined}</span></div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
