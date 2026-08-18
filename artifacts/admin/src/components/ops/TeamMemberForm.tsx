import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface Department { id: number; name: string; }
interface User { id: string; email: string; firstName?: string | null; lastName?: string | null; }
interface TeamMemberWithUser {
  id: number;
  userId: string;
  role: string;
  departmentId?: number | null;
  notes?: string | null;
  isActive: boolean;
  user?: User | null;
}

const memberSchema = z.object({
  userId: z.string().optional(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
  departmentId: z.coerce.number().optional().nullable(),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});

type MemberFormValues = z.infer<typeof memberSchema>;

interface TeamMemberFormProps {
  open: boolean;
  onClose: () => void;
  member?: TeamMemberWithUser;
}

export function TeamMemberForm({ open, onClose, member }: TeamMemberFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: users } = useQuery<User[]>({
    queryKey: ["ops-users"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/users");
      if (!r.ok) throw new Error("Failed to fetch users");
      return r.json();
    },
    enabled: open && !member,
  });

  const { data: teamMembers } = useQuery<TeamMemberWithUser[]>({
    queryKey: ["ops-team-members"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/team");
      if (!r.ok) throw new Error("Failed to fetch team members");
      return r.json();
    },
    enabled: open && !member,
  });

  const { data: departments } = useQuery<Department[]>({
    queryKey: ["ops-departments"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/departments");
      if (!r.ok) throw new Error("Failed to fetch departments");
      return r.json();
    },
    enabled: open,
  });

  const availableUsers = useMemo(() => {
    if (!users || !teamMembers) return users ?? [];
    const teamUserIds = new Set(teamMembers.map(tm => tm.userId));
    return users.filter(u => !teamUserIds.has(u.id));
  }, [users, teamMembers]);

  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: {
      userId: "",
      role: "member",
      departmentId: null,
      notes: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (open) {
      if (member) {
        form.reset({
          userId: member.userId,
          role: (member.role as "owner" | "admin" | "member" | "viewer") || "member",
          departmentId: member.departmentId,
          notes: member.notes || "",
          isActive: member.isActive,
        });
      } else {
        form.reset({ userId: "", role: "member", departmentId: null, notes: "", isActive: true });
      }
    }
  }, [open, member, form]);

  const createMember = useMutation({
    mutationFn: async (data: MemberFormValues) => {
      const r = await authFetch("/api/ops/team", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create team member");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Team member added" });
      queryClient.invalidateQueries({ queryKey: ["ops-team-members"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to add team member", variant: "destructive" }),
  });

  const updateMember = useMutation({
    mutationFn: async (data: Partial<MemberFormValues>) => {
      const r = await authFetch(`/api/ops/team/${member!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update team member");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Team member updated" });
      queryClient.invalidateQueries({ queryKey: ["ops-team-members"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to update team member", variant: "destructive" }),
  });

  const onSubmit = (data: MemberFormValues) => {
    if (member) {
      updateMember.mutate({
        role: data.role,
        departmentId: data.departmentId === null ? undefined : data.departmentId,
        isActive: data.isActive,
        notes: data.notes,
      });
    } else {
      createMember.mutate(data);
    }
  };

  const isPending = createMember.isPending || updateMember.isPending;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={member ? "Edit Team Member" : "Add Team Member"}
      description={member ? "Update member details and role" : "Add a registered user to the team"}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {!member && (
            <FormField
              control={form.control}
              name="userId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>User</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a user" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(availableUsers ?? []).map(u => (
                        <SelectItem key={u.id} value={u.id}>
                          <div className="flex items-center gap-2">
                            <Avatar className="w-5 h-5">
                              <AvatarFallback className="text-[10px]">
                                {(u.firstName?.[0] ?? u.email[0]).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span>{u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Role</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="owner">Owner</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="departmentId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Department (Optional)</FormLabel>
                <Select
                  onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))}
                  value={field.value?.toString() ?? "none"}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="No department" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">No department</SelectItem>
                    {(departments ?? []).map(d => (
                      <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Internal notes about this member" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {member && (
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Active Status</FormLabel>
                    <FormDescription>
                      Deactivate to revoke access to team resources without deleting history.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          )}

          <FormDialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Member"}
            </Button>
          </FormDialogFooter>
        </form>
      </Form>
    </FormDialog>
  );
}
