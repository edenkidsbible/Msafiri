import { useState } from "react";
import { AdminLayout } from "@/components/layout/admin-layout";
import { useAdminListUsers, useAdminCreateUser, useAdminDeleteUser, useAdminUpdateUser } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ShieldAlert, Trash2, Plus, Users as UsersIcon, Edit } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { getUser } from "@/lib/auth";
import type { AdminUser } from "@workspace/api-client-react/generated/api.schemas";

const userSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters").or(z.literal("")),
  role: z.enum(["admin", "staff"]),
});

export default function Users() {
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currentUser = getUser();

  const { data, isLoading } = useAdminListUsers();

  const deleteMutation = useAdminDeleteUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Operator Access Revoked", description: "The account has been removed from the system." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        setUserToDelete(null);
      },
      onError: () => {
        toast({ title: "Operation Failed", description: "Unable to revoke access.", variant: "destructive" });
        setUserToDelete(null);
      }
    }
  });

  const createMutation = useAdminCreateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Operator Added", description: "New clearance granted successfully." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        setIsAddOpen(false);
        form.reset();
      },
      onError: (error) => {
        toast({ title: "Provisioning Failed", description: error.message || "Could not create operator account.", variant: "destructive" });
      }
    }
  });

  const updateMutation = useAdminUpdateUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "Operator Updated", description: "Account credentials and clearance updated." });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        setEditingUser(null);
      },
      onError: (error) => {
        toast({ title: "Update Failed", description: error.message || "Could not update operator account.", variant: "destructive" });
      }
    }
  });

  const form = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      role: "staff",
    },
  });

  const editForm = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
  });

  const handleDelete = () => {
    if (userToDelete) {
      deleteMutation.mutate({ id: userToDelete });
    }
  };

  const onSubmit = (values: z.infer<typeof userSchema>) => {
    createMutation.mutate({ data: { ...values, password: values.password || "default123" } });
  };

  const onEditSubmit = (values: z.infer<typeof userSchema>) => {
    if (editingUser) {
      const dataToUpdate: any = { name: values.name, email: values.email, role: values.role };
      if (values.password) {
        dataToUpdate.password = values.password;
      }
      updateMutation.mutate({ id: editingUser.id, data: dataToUpdate });
    }
  };

  const openEditDialog = (user: AdminUser) => {
    editForm.reset({
      name: user.name,
      email: user.email,
      role: user.role as "admin" | "staff",
      password: "",
    });
    setEditingUser(user);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-border pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight uppercase font-mono">Operator Roster</h1>
            <p className="text-muted-foreground mt-1">Manage personnel clearance and system access.</p>
          </div>
          
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 font-mono uppercase tracking-wider">
                <Plus className="h-4 w-4" /> Grant Access
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle className="uppercase font-mono tracking-wider">Provision New Operator</DialogTitle>
                <DialogDescription>
                  Enter details to grant system access. A secure clearance code is required.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Designation (Name)</FormLabel>
                        <FormControl>
                          <Input placeholder="John Doe" {...field} className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Comm Channel (Email)</FormLabel>
                        <FormControl>
                          <Input placeholder="operator@safedrive.co.ke" {...field} className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Clearance Code (Password)</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Clearance Level</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Select level" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="staff">Staff (Standard)</SelectItem>
                            <SelectItem value="admin">Admin (Elevated)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter className="pt-4">
                    <Button type="submit" disabled={createMutation.isPending} className="font-mono uppercase w-full">
                      {createMutation.isPending ? "Provisioning..." : "Authorize"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="border border-border/50 rounded-md bg-card/30 overflow-hidden">
          <Table>
            <TableHeader className="bg-secondary/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-xs uppercase tracking-wider">Designation</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Comm Channel</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Clearance</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider">Commissioned</TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    Accessing personnel records...
                  </TableCell>
                </TableRow>
              ) : data?.users?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <UsersIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-50" />
                    <p className="text-muted-foreground">No personnel records found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.users?.map((user) => (
                  <TableRow key={user.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {user.role === 'admin' ? (
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 gap-1 font-mono uppercase text-xs">
                          <ShieldAlert className="h-3 w-3" /> Admin
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-secondary text-secondary-foreground border-secondary gap-1 font-mono uppercase text-xs">
                          <Shield className="h-3 w-3" /> Staff
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(user.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      {currentUser?.id !== user.id && (
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(user)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setUserToDelete(user.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="bg-card border-border sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="uppercase font-mono tracking-wider">Update Operator</DialogTitle>
            <DialogDescription>
              Modify details for {editingUser?.name}.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 pt-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Designation (Name)</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comm Channel (Email)</FormLabel>
                    <FormControl>
                      <Input placeholder="operator@safedrive.co.ke" {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Clearance Code (Leave blank to keep current)</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} className="bg-background" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Clearance Level</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select level" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="staff">Staff (Standard)</SelectItem>
                        <SelectItem value="admin">Admin (Elevated)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="pt-4">
                <Button type="submit" disabled={updateMutation.isPending} className="font-mono uppercase w-full">
                  {updateMutation.isPending ? "Updating..." : "Update Clearance"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!userToDelete} onOpenChange={(open) => !open && setUserToDelete(null)}>
        <AlertDialogContent className="bg-card border-destructive/20">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <ShieldAlert className="h-5 w-5" />
              Revoke Clearance
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently revoke system access for this operator. They will be immediately disconnected from the grid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-transparent">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Revoke Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
