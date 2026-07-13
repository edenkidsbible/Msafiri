import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListUsers, useAdminCreateUser, useAdminDeleteUser, useAdminUpdateUser } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, ShieldAlert, ShieldCheck, Trash2, Plus, Users as UsersIcon, Edit, Loader2, MoreHorizontal, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { getUser } from "@/lib/auth";
import type { AdminUser } from "@workspace/api-client-react";

type AdminUserWithPermissions = AdminUser & { permissions?: string[] | null };

const ROLES = [
  {
    value: "admin",
    label: "Admin",
    description: "Full access — manage team, view analytics, all content",
    icon: ShieldAlert,
    badge: "bg-primary/10 text-primary border-primary/20",
  },
  {
    value: "moderator",
    label: "Moderator",
    description: "Manage reports, blog, push campaigns, billing & more",
    icon: ShieldCheck,
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  {
    value: "staff",
    label: "Staff",
    description: "View & edit reports and speed zones only",
    icon: Shield,
    badge: "bg-secondary text-secondary-foreground border-secondary",
  },
];

const FEATURE_GROUPS = [
  {
    group: "Content",
    features: [
      { key: "reports",        label: "Incident Reports (view / edit / create)" },
      { key: "speed_zones",    label: "Speed Zones (view / edit / create)" },
      { key: "blog",           label: "Blog Management" },
    ],
  },
  {
    group: "Operations",
    features: [
      { key: "reports_bulk",   label: "Bulk Report Actions" },
      { key: "reports_export", label: "Export Reports CSV" },
      { key: "push_campaigns", label: "Push Campaigns" },
      { key: "releases",       label: "App Release Management" },
    ],
  },
  {
    group: "Management",
    features: [
      { key: "notifications",  label: "Notifications" },
      { key: "subscribers",    label: "Subscriber & Billing" },
      { key: "audit_log",      label: "Audit Log" },
      { key: "dashboard",      label: "Analytics Dashboard" },
      { key: "team",           label: "Team Member Management" },
    ],
  },
];

const ALL_FEATURE_KEYS = FEATURE_GROUPS.flatMap((g) => g.features.map((f) => f.key));

const ROLE_DEFAULTS: Record<string, string[]> = {
  admin:     [...ALL_FEATURE_KEYS],
  moderator: ["reports", "speed_zones", "blog", "reports_bulk", "reports_export", "push_campaigns", "releases", "notifications", "subscribers", "audit_log"],
  staff:     ["reports", "speed_zones"],
};

const createUserSchema = z.object({
  name:     z.string().min(2, "Name is required"),
  email:    z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role:     z.enum(["admin", "moderator", "staff"]),
});

const editUserSchema = z.object({
  name:     z.string().min(2, "Name is required"),
  email:    z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters").or(z.literal("")),
  role:     z.enum(["admin", "moderator", "staff"]),
});

function FeatureChecklist({
  role,
  value,
  onChange,
}: {
  role: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const defaults = ROLE_DEFAULTS[role] ?? [];
  const isDefault = (key: string) => defaults.includes(key);

  const toggle = (key: string) => {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  };

  const resetToDefaults = () => onChange([...defaults]);
  const matchesDefaults = JSON.stringify([...value].sort()) === JSON.stringify([...defaults].sort());

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Feature Access</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={resetToDefaults}
          disabled={matchesDefaults}
        >
          <RotateCcw className="h-3 w-3" />
          Reset to role defaults
        </Button>
      </div>
      <ScrollArea className="h-[220px] rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <div className="space-y-4 pr-2">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.group}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                {group.group}
              </p>
              <div className="space-y-1.5">
                {group.features.map((f) => {
                  const checked = value.includes(f.key);
                  const isRoleDefault = isDefault(f.key);
                  return (
                    <label
                      key={f.key}
                      className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors group"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(f.key)}
                        className="shrink-0"
                      />
                      <span className="text-sm text-foreground flex-1">{f.label}</span>
                      {!isRoleDefault && checked && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-600 border-amber-500/20 shrink-0">
                          Extra
                        </Badge>
                      )}
                      {isRoleDefault && !checked && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-destructive/10 text-destructive border-destructive/20 shrink-0">
                          Revoked
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <p className="text-[11px] text-muted-foreground">
        {value.length} of {ALL_FEATURE_KEYS.length} features enabled
        {!matchesDefaults && <span className="text-amber-600 ml-1">· Custom overrides active</span>}
      </p>
    </div>
  );
}

export default function Users() {
  const rawSearch = useSearch();
  const highlightId = new URLSearchParams(rawSearch).get("highlight");
  const highlightHandled = useRef(false);

  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserWithPermissions | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);

  const [createPerms, setCreatePerms] = useState<string[]>(ROLE_DEFAULTS["staff"]!);
  const [editPerms, setEditPerms] = useState<string[]>([]);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentUser = getUser();

  const { data, isLoading } = useAdminListUsers();

  const deleteMutation = useAdminDeleteUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account deleted", description: "The team member has been removed." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        setUserToDelete(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to remove account.", variant: "destructive" });
        setUserToDelete(null);
      }
    }
  });

  const createMutation = useAdminCreateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Member added", description: "New account has been created." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        setIsAddOpen(false);
        form.reset();
        setCreatePerms(ROLE_DEFAULTS["staff"]!);
      },
      onError: (error) => {
        toast({ title: "Creation Failed", description: error.message || "Could not create account.", variant: "destructive" });
      }
    }
  });

  const updateMutation = useAdminUpdateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account updated", description: "Details saved successfully." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        setEditingUser(null);
      },
      onError: (error) => {
        toast({ title: "Update Failed", description: error.message || "Could not update account.", variant: "destructive" });
      }
    }
  });

  const form = useForm<z.infer<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", role: "staff" },
  });

  const editForm = useForm<z.infer<typeof editUserSchema>>({
    resolver: zodResolver(editUserSchema),
  });

  const watchCreateRole = form.watch("role");
  const watchEditRole = editForm.watch("role");

  useEffect(() => {
    setCreatePerms(ROLE_DEFAULTS[watchCreateRole] ?? []);
  }, [watchCreateRole]);

  useEffect(() => {
    if (editingUser && watchEditRole) {
      const defaults = ROLE_DEFAULTS[watchEditRole] ?? [];
      const stored = editingUser.permissions;
      if (stored) {
        setEditPerms(stored);
      } else {
        setEditPerms(defaults);
      }
    }
  }, [watchEditRole]);

  const handleDelete = () => {
    if (userToDelete) deleteMutation.mutate({ id: userToDelete });
  };

  const onSubmit = (values: z.infer<typeof createUserSchema>) => {
    const defaultPerms = ROLE_DEFAULTS[values.role] ?? [];
    const isDefault = JSON.stringify([...createPerms].sort()) === JSON.stringify([...defaultPerms].sort());
    createMutation.mutate({ data: { ...values, permissions: isDefault ? null : createPerms } as any });
  };

  const onEditSubmit = (values: z.infer<typeof editUserSchema>) => {
    if (!editingUser) return;
    const defaultPerms = ROLE_DEFAULTS[values.role] ?? [];
    const isDefault = JSON.stringify([...editPerms].sort()) === JSON.stringify([...defaultPerms].sort());
    const dataToUpdate: any = { name: values.name, email: values.email, role: values.role, permissions: isDefault ? null : editPerms };
    if (values.password) dataToUpdate.password = values.password;
    updateMutation.mutate({ id: editingUser.id, data: dataToUpdate });
  };

  const openEditDialog = (user: AdminUserWithPermissions) => {
    editForm.reset({ name: user.name, email: user.email, role: user.role as any, password: "" });
    const defaults = ROLE_DEFAULTS[user.role] ?? [];
    setEditPerms(user.permissions ?? defaults);
    setEditingUser(user);
  };

  const getRoleInfo = (role: string) => ROLES.find((r) => r.value === role) ?? ROLES[2];

  const users = (data?.users ?? []) as AdminUserWithPermissions[];

  // Deep-link support from global search: ?highlight=<id> opens that user's
  // edit dialog directly once the (unpaginated) list has loaded.
  useEffect(() => {
    if (!highlightId || highlightHandled.current) return;
    const match = users.find((u) => u.id === highlightId);
    if (match) {
      openEditDialog(match);
      highlightHandled.current = true;
    }
  }, [highlightId, users]);

  return (
    <AdminLayout>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground" data-testid="text-page-title">Team Members</h1>
            <p className="text-muted-foreground mt-1" data-testid="text-page-description">Manage access to the Msafiri Ops platform.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" className="gap-2 shadow-none" onClick={() => setShowPermissions(!showPermissions)}>
              <ShieldCheck className="h-4 w-4" />
              {showPermissions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showPermissions ? "Hide" : "View"} Permission Map
            </Button>
            <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) { form.reset(); setCreatePerms(ROLE_DEFAULTS["staff"]!); } }}>
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="btn-add-user">
                  <Plus className="h-4 w-4" /> Add Member
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                  <DialogTitle>Add Team Member</DialogTitle>
                  <DialogDescription>Create a new account with customised feature access.</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
                    <FormField control={form.control} name="name" render={({ field }) => (
                      <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input placeholder="Jane Doe" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="email" render={({ field }) => (
                      <FormItem><FormLabel>Work Email</FormLabel><FormControl><Input placeholder="jane@msafiri.co.ke" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="password" render={({ field }) => (
                      <FormItem><FormLabel>Initial Password</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="role" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Base Role</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                <div className="flex flex-col py-0.5">
                                  <span className="font-medium">{r.label}</span>
                                  <span className="text-xs text-muted-foreground">{r.description}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FeatureChecklist role={watchCreateRole} value={createPerms} onChange={setCreatePerms} />
                    <DialogFooter className="pt-2">
                      <Button type="submit" disabled={createMutation.isPending} className="w-full">
                        {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {createMutation.isPending ? "Creating..." : "Create Account"}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {showPermissions && (
          <Card className="shadow-sm border-border/60">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base font-semibold">Role Permission Defaults</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm mt-4">
                <thead>
                  <tr>
                    <th className="text-left font-medium text-muted-foreground pb-3 pr-6">Feature</th>
                    {ROLES.map((r) => (
                      <th key={r.value} className="text-center font-medium pb-3 px-4">
                        <Badge variant="outline" className={`${r.badge} shadow-none`}>{r.label}</Badge>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_GROUPS.map((group) => (
                    <>
                      <tr key={`group-${group.group}`}>
                        <td colSpan={4} className="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.group}
                        </td>
                      </tr>
                      {group.features.map((f) => (
                        <tr key={f.key} className="border-t border-border/40">
                          <td className="py-2 pr-6 text-foreground">{f.label}</td>
                          {ROLES.map((r) => (
                            <td key={r.value} className="py-2 px-4 text-center">
                              {ROLE_DEFAULTS[r.value]?.includes(f.key)
                                ? <span className="text-emerald-500">✓</span>
                                : <span className="text-muted-foreground/30">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-4 pb-1">Individual users can have these defaults overridden when editing their account.</p>
            </CardContent>
          </Card>
        )}

        <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Member Name</TableHead>
                <TableHead>Email Address</TableHead>
                <TableHead className="w-[160px]">Role</TableHead>
                <TableHead className="w-[120px]">Features</TableHead>
                <TableHead className="w-[140px]">Joined</TableHead>
                <TableHead className="w-[70px] text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                    Loading accounts...
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-48 text-center">
                    <UsersIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No team members found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => {
                  const roleInfo = getRoleInfo(user.role);
                  const RoleIcon = roleInfo.icon;
                  const effectivePerms = user.permissions ?? ROLE_DEFAULTS[user.role] ?? [];
                  const hasCustomPerms = !!user.permissions;
                  return (
                    <TableRow key={user.id} className="hover:bg-muted/30 transition-colors group" data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium text-foreground">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`gap-1.5 shadow-none ${roleInfo.badge}`}>
                          <RoleIcon className="h-3 w-3" /> {roleInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-muted-foreground">{effectivePerms.length}/{ALL_FEATURE_KEYS.length}</span>
                          {hasCustomPerms && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-600 border-amber-500/20">
                              Custom
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(user.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        {currentUser?.id !== user.id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => openEditDialog(user)} className="cursor-pointer">
                                <Edit className="mr-2 h-4 w-4" /> Edit Account
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setUserToDelete(user.id)} className="text-destructive focus:text-destructive cursor-pointer">
                                <Trash2 className="mr-2 h-4 w-4" /> Delete Account
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Update Team Member</DialogTitle>
            <DialogDescription>Modify details and feature access for {editingUser?.name}.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={editForm.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="email" render={({ field }) => (
                  <FormItem><FormLabel>Work Email</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>New Password <span className="text-muted-foreground font-normal">(leave blank to keep current)</span></FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Base Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <div className="flex flex-col py-0.5">
                            <span className="font-medium">{r.label}</span>
                            <span className="text-xs text-muted-foreground">{r.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FeatureChecklist role={watchEditRole} value={editPerms} onChange={setEditPerms} />
              <DialogFooter className="pt-2">
                <Button type="submit" disabled={updateMutation.isPending} className="w-full">
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this team member? They will lose access to the platform immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
