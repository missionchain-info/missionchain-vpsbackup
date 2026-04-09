'use client';

import SectionHead from '@/components/ui/SectionHead';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';

const admins = [
  { name: 'Thani Dusit', role: 'SUPER_ADMIN', modules: 'All', lastActive: 'Now', status: 'Active' },
  { name: 'Admin 2', role: 'FINANCE_ADMIN', modules: 'Apps, Shared', lastActive: '14:28', status: 'Active' },
  { name: 'Admin 3', role: 'CONTENT_ADMIN', modules: 'Info, World', lastActive: '13:45', status: 'Active' },
  { name: 'Admin 4', role: 'KYC_REVIEWER', modules: 'Shared (KYC only)', lastActive: '12:10', status: 'Active' },
  { name: 'Mod 1', role: 'MODERATOR', modules: 'World', lastActive: '11:55', status: 'Active' },
];

const columns = [
  { key: 'name', label: 'Admin' },
  { key: 'role', label: 'Role', render: (v: string) => <Badge variant="purple">{v}</Badge> },
  { key: 'modules', label: 'Modules' },
  { key: 'lastActive', label: 'Last Active', className: 'td-mono' },
  { key: 'status', label: 'Status', render: () => <Badge variant="active">Active</Badge> },
  { key: 'action', label: 'Action', render: () => <button className="btn btn-outline btn-sm">Edit</button> },
];

export default function RBACPage() {
  return (
    <>
      <SectionHead title="Roles & Permissions" action={<button className="btn btn-primary btn-sm">+ Add Admin</button>} />
      <DataTable columns={columns} data={admins} />
    </>
  );
}
