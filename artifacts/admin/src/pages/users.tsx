import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListUsers, useAdminCreateUser, useAdminDeleteUser, useAdminUpdateUser } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, ShieldAlert, ShieldCheck, Trash2, Plus, Users as UsersIcon, Edit, Loader2, MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { getUser } from "@/lib/auth";
import type { AdminUser } from "@workspace/api-client-react";

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
    description: "Manage reports (incl. bulk actions), view audit log & subscribers",
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

const PERMISSIONS = [
  { feature: "Incident Reports (view/edit/create)", admin: true, moderator: true, staff: true },
  { feature: "Speed Zones (view/edit/create)",      admin: true, moderator: true, staff: true },
  { feature: "Bulk Report Actions",                 admin: true, moderator: true, staff: false },
  { feature: "Export Reports CSV",                  admin: true, moderator: true, staff: false },
  { feature: "Notifications",                       admin: true, moderator: true, staff: false },
  { feature: "Audit Log",                           admin: true, moderator: true, staff: false },
  { feature: "Subscriber & Billing",                admin: true, moderator: true, staff: false },
  { feature: "Analytics Dashboard",                 admin: true, moderator: false, staff: false },
  { feature: "Team Member Management",              admin: true, moderator: false, staff: false },
];

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

export default function Users() {
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [showPermissions, setShowPermissions] = useState(false);
  
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

  const handleDelete = () => {
    if (userToDelete) deleteMutation.mutate({ id: userToDelete });
  };

  const onSubmit = (values: z.infer<typeof createUserSchema>) => {
    createMutation.mutate({ data: values });
  };

  const onEditSubmit = (values: z.infer<typeof editUserSchema>) => {
    if (editingUser) {
      const dataToUpdate: any = { name: values.name, email: values.email, role: values.role };
      if (values.password) dataToUpdate.password = values.password;
      updateMutation.mutate({ id: editingUser.id, data: dataToUpdate });
    }
  };

  const openEditDialog = (user: AdminUser) => {
    editForm.reset({ name: user.name, email: user.email, role: user.role as any, password: "" });
    setEditingUser(user);
  };

  const getRoleInfo = (role: string) => ROLES.find((r) => r.value === role) ?? ROLES[2];

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
              {showPermissions ? "Hide" : "View"} Permissions
            </Button>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" data-testid="btn-add-user">
                  <Plus className="h-4 w-4" /> Add Member
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Add Team Member</DialogTitle>
                  <DialogDescription>Create a new account with access to the dashboard.</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
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
                        <FormLabel>Access Role</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger></FormControl>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                <div className="flex flex-col">
                                  <span>{r.label}</span>
                                  <span className="text-xs text-muted-foreground">{r.description}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <DialogFooter className="pt-4">
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
                <CardTitle className="text-base font-semibold">Permission Levels</CardTitle>
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
                  {PERMISSIONS.map((p, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-2.5 pr-6 text-foreground">{p.feature}</td>
                      <td className="py-2.5 px-4 text-center">{p.admin ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground/30">—</span>}</td>
                      <td className="py-2.5 px-4 text-center">{p.moderator ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground/30">—</span>}</td>
                      <td className="py-2.5 px-4 text-center">{p.staff ? <span className="text-emerald-500">✓</span> : <span className="text-muted-foreground/30">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Member Name</TableHead>
                <TableHead>Email Address</TableHead>
                <TableHead className="w-[180px]">Role</TableHead>
                <TableHead className="w-[150px]">Joined</TableHead>
                <TableHead className="w-[70px] text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
                    Loading accounts...
                  </TableCell>
                </TableRow>
              ) : data?.users?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-48 text-center">
                    <UsersIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3 opacity-20" />
                    <p className="text-muted-foreground font-medium">No team members found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.users?.map((user) => {
                  const roleInfo = getRoleInfo(user.role);
                  const RoleIcon = roleInfo.icon;
                  return (
                    <TableRow key={user.id} className="hover:bg-muted/30 transition-colors group" data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium text-foreground">{user.name}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`gap-1.5 shadow-none ${roleInfo.badge}`}>
                          <RoleIcon className="h-3 w-3" /> {roleInfo.label}
                        </Badge>
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
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Update Team Member</DialogTitle>
            <DialogDescription>Modify details for {editingUser?.name}.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Work Email</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>New Password (leave blank to keep current)</FormLabel><FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Access Role</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <div className="flex flex-col">
                            <span>{r.label}</span>
                            <span className="text-xs text-muted-foreground">{r.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter className="pt-4">
                <Button type="submit" disabled={updateMutation.isPending} className="w-full">
                  {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {updateMutation.isPending ? "Updating..." : "Save Changes"}
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
