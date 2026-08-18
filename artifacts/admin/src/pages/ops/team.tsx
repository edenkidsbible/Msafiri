import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, getUser } from "@/lib/auth";
import { Plus, Building, Users, MoreHorizontal, Pencil, Trash2, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DepartmentForm } from "@/components/ops/DepartmentForm";
import { TeamMemberForm } from "@/components/ops/TeamMemberForm";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Department {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt?: string;
}

interface TeamMember {
  id: number;
  adminUserId: string;
  role: string;
  departmentId: number | null;
  departmentName: string | null;
  isActive: boolean;
  notes: string | null;
  name: string | null;
  email: string | null;
}

interface Invitation {
  id: number;
  email: string;
  role: string;
  departmentId: number | null;
  departmentName: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  token: string;
}

const ROLE_COLORS: Record<string, string> = {
  founder: "bg-destructive text-destructive-foreground",
  admin: "bg-amber-500 text-white",
  member: "bg-primary text-primary-foreground",
  viewer: "bg-muted text-muted-foreground",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border border-amber-200",
  accepted: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  expired: "bg-muted text-muted-foreground",
  revoked: "bg-destructive/10 text-destructive",
};

function useAdminUsers() {
  return useQuery<AdminUser[]>({
    queryKey: ["ops", "team", "admin-users"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/team/users");
      if (!r.ok) throw new Error("Failed to load users");
      return r.json();
    },
  });
}

function useDepartments() {
  return useQuery<Department[]>({
    queryKey: ["ops", "team", "departments"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/team/departments");
      if (!r.ok) throw new Error("Failed to load departments");
      return r.json();
    },
  });
}

function useTeamMembers() {
  return useQuery<TeamMember[]>({
    queryKey: ["ops", "team", "members"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/team/members");
      if (!r.ok) throw new Error("Failed to load team members");
      return r.json();
    },
  });
}

function useInvitations() {
  return useQuery<Invitation[]>({
    queryKey: ["ops", "team", "invitations"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/invitations");
      if (!r.ok) throw new Error("Failed to load invitations");
      return r.json();
    },
  });
}

export default function TeamPage() {
  const me = getUser();
  const isOwnerOrAdmin = me?.role === "founder" || me?.role === "admin";
  const qc = useQueryClient();

  const { data: users, isLoading: usersLoading } = useAdminUsers();
  const { data: departments, isLoading: deptsLoading } = useDepartments();
  const { data: members, isLoading: membersLoading } = useTeamMembers();
  const { data: invitations } = useInvitations();

  const [memberDialog, setMemberDialog] = useState<{ open: boolean; item?: TeamMember }>({ open: false });
  const [deptDialog, setDeptDialog] = useState<{ open: boolean; item?: Department }>({ open: false });
  const [inviteDialog, setInviteDialog] = useState(false);
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null);
  const [deptToDelete, setDeptToDelete] = useState<Department | null>(null);

  const deleteMember = useMutation({
    mutationFn: (id: number) => authFetch(`/api/ops/team/members/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops", "team"] });
      setMemberToDelete(null);
    },
  });

  const deleteDept = useMutation({
    mutationFn: (id: number) => authFetch(`/api/ops/team/departments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops", "team"] });
      setDeptToDelete(null);
    },
  });

  const revokeInvitation = useMutation({
    mutationFn: (id: number) => authFetch(`/api/ops/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "team", "invitations"] }),
  });

  // Compute dept member counts
  const deptCounts: Record<number, number> = {};
  members?.forEach((m) => {
    if (m.departmentId) deptCounts[m.departmentId] = (deptCounts[m.departmentId] || 0) + 1;
  });

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ["ops", "team"] });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground text-sm">Manage your team members and departments</p>
        </div>
        {isOwnerOrAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeptDialog({ open: true })}>
              <Building className="w-4 h-4 mr-1.5" /> Add Department
            </Button>
            <Button size="sm" onClick={() => setMemberDialog({ open: true })}>
              <Plus className="w-4 h-4 mr-1.5" /> Add Member
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">
            <Users className="w-4 h-4 mr-1.5" />
            Members {members ? `(${members.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="departments">
            <Building className="w-4 h-4 mr-1.5" />
            Departments {departments ? `(${departments.length})` : ""}
          </TabsTrigger>
          {isOwnerOrAdmin && (
            <TabsTrigger value="invitations">
              Invitations {invitations?.filter(i => i.status === "pending").length ? `(${invitations.filter(i => i.status === "pending").length})` : ""}
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Members Tab ── */}
        <TabsContent value="members" className="mt-4">
          <Card className="border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left font-medium p-4 text-muted-foreground">Member</th>
                    <th className="text-left font-medium p-4 text-muted-foreground">Role</th>
                    <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Department</th>
                    <th className="text-left font-medium p-4 text-muted-foreground hidden lg:table-cell">Status</th>
                    {isOwnerOrAdmin && <th className="w-12" />}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {membersLoading ? (
                    [1, 2, 3].map(i => (
                      <tr key={i}><td colSpan={5} className="p-4"><Skeleton className="h-5 w-full" /></td></tr>
                    ))
                  ) : members?.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-4">
                        <div className="font-medium">{m.name || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </td>
                      <td className="p-4">
                        <Badge className={ROLE_COLORS[m.role] || ""} variant="secondary">{m.role}</Badge>
                      </td>
                      <td className="p-4 text-muted-foreground hidden md:table-cell">{m.departmentName || "—"}</td>
                      <td className="p-4 hidden lg:table-cell">
                        <Badge variant={m.isActive ? "default" : "secondary"}>
                          {m.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      {isOwnerOrAdmin && (
                        <td className="p-4">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setMemberDialog({ open: true, item: m })}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setMemberToDelete(m)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!membersLoading && !members?.length && (
                    <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No team members yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ── Departments Tab ── */}
        <TabsContent value="departments" className="mt-4">
          <Card className="border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th className="text-left font-medium p-4 text-muted-foreground">Department</th>
                    <th className="text-left font-medium p-4 text-muted-foreground w-28">Status</th>
                    <th className="text-right font-medium p-4 text-muted-foreground w-24">Members</th>
                    {isOwnerOrAdmin && <th className="w-12" />}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {deptsLoading ? (
                    [1, 2, 3].map(i => (
                      <tr key={i}><td colSpan={4} className="p-4"><Skeleton className="h-5 w-full" /></td></tr>
                    ))
                  ) : departments?.map((dept) => (
                    <tr key={dept.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-4">
                        <div className="font-medium">{dept.name}</div>
                        {dept.description && (
                          <div className="text-xs text-muted-foreground mt-1 max-w-md truncate">{dept.description}</div>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge variant={dept.isActive ? "default" : "secondary"}>
                          {dept.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="p-4 text-right font-medium">{deptCounts[dept.id] || 0}</td>
                      {isOwnerOrAdmin && (
                        <td className="p-4">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setDeptDialog({ open: true, item: dept })}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeptToDelete(dept)}
                                disabled={(deptCounts[dept.id] || 0) > 0}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!deptsLoading && !departments?.length && (
                    <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">No departments yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ── Invitations Tab ── */}
        {isOwnerOrAdmin && (
          <TabsContent value="invitations" className="mt-4">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setInviteDialog(true)}>
                <Plus className="w-4 h-4 mr-1.5" /> Send Invitation
              </Button>
            </div>
            <Card className="border shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left font-medium p-4 text-muted-foreground">Email</th>
                      <th className="text-left font-medium p-4 text-muted-foreground">Role</th>
                      <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Department</th>
                      <th className="text-left font-medium p-4 text-muted-foreground">Status</th>
                      <th className="text-left font-medium p-4 text-muted-foreground hidden md:table-cell">Expires</th>
                      <th className="w-24" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invitations?.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                        <td className="p-4 font-medium">{inv.email}</td>
                        <td className="p-4">
                          <Badge className={ROLE_COLORS[inv.role] || ""} variant="secondary">{inv.role}</Badge>
                        </td>
                        <td className="p-4 text-muted-foreground hidden md:table-cell">{inv.departmentName || "—"}</td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[inv.status] || ""}`}>
                            {inv.status === "accepted" && <CheckCircle2 className="w-3 h-3" />}
                            {inv.status === "pending" && <Clock className="w-3 h-3" />}
                            {inv.status}
                          </span>
                        </td>
                        <td className="p-4 text-muted-foreground hidden md:table-cell text-xs">
                          {new Date(inv.expiresAt).toLocaleDateString("en-KE")}
                        </td>
                        <td className="p-4 text-right">
                          {inv.status === "pending" && (
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const url = `${window.location.origin}/ops/accept-invite?token=${inv.token}`;
                                  navigator.clipboard.writeText(url);
                                }}
                              >
                                Copy link
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => revokeInvitation.mutate(inv.id)}
                              >
                                Revoke
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!invitations?.length && (
                      <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No invitations sent yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Dialogs ── */}
      <TeamMemberForm
        open={memberDialog.open}
        onClose={() => { setMemberDialog({ open: false }); invalidateAll(); }}
        member={memberDialog.item as any}
      />

      <DepartmentForm
        open={deptDialog.open}
        onClose={() => { setDeptDialog({ open: false }); invalidateAll(); }}
        department={deptDialog.item}
      />

      {/* Invite dialog (simplified — just show create form) */}
      <Dialog open={inviteDialog} onOpenChange={setInviteDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Invitation</DialogTitle>
          </DialogHeader>
          <InviteFormSimple
            departments={departments || []}
            onSuccess={() => { setInviteDialog(false); qc.invalidateQueries({ queryKey: ["ops", "team", "invitations"] }); }}
            onCancel={() => setInviteDialog(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete member confirm */}
      <AlertDialog open={!!memberToDelete} onOpenChange={(o) => !o && setMemberToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {memberToDelete?.name || "this user"} from the team? They will lose team access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMember.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => memberToDelete && deleteMember.mutate(memberToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMember.isPending}
            >
              {deleteMember.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete dept confirm */}
      <AlertDialog open={!!deptToDelete} onOpenChange={(o) => !o && setDeptToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete department?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deptToDelete?.name}"? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDept.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deptToDelete && deleteDept.mutate(deptToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteDept.isPending}
            >
              {deleteDept.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Inline invite form ────────────────────────────────────────────────────────

function InviteFormSimple({
  departments, onSuccess, onCancel,
}: { departments: Department[]; onSuccess: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [deptId, setDeptId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ token: string; email: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await authFetch("/api/ops/invitations", {
        method: "POST",
        body: JSON.stringify({ email, role, departmentId: deptId ? parseInt(deptId) : null }),
      });
      if (!r.ok) {
        const d = await r.json();
        setError(d.error || "Failed to create invitation");
        return;
      }
      const data = await r.json();
      setResult({ token: data.token, email: data.email });
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    const link = `${window.location.origin}/ops/accept-invite?token=${result.token}`;
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Invitation created for <strong>{result.email}</strong>. Share this link:</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 text-xs bg-muted rounded px-3 py-2 font-mono border truncate"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button size="sm" onClick={() => navigator.clipboard.writeText(link)}>Copy</Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={onSuccess}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          placeholder="name@example.com"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
        >
          <option value="viewer">Viewer</option>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {departments.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Department (optional)</label>
          <select
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            <option value="">— None —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create Invitation"}</Button>
      </div>
    </form>
  );
}
