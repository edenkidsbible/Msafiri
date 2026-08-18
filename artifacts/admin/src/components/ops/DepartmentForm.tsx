import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface Department {
  id: number;
  name: string;
  description?: string | null;
  isActive: boolean;
}

const departmentSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  isActive: z.boolean().default(true),
});

type DepartmentFormValues = z.infer<typeof departmentSchema>;

interface DepartmentFormProps {
  open: boolean;
  onClose: () => void;
  department?: Department;
}

export function DepartmentForm({ open, onClose, department }: DepartmentFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues: {
      name: "",
      description: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (open) {
      if (department) {
        form.reset({
          name: department.name,
          description: department.description || "",
          isActive: department.isActive,
        });
      } else {
        form.reset({ name: "", description: "", isActive: true });
      }
    }
  }, [open, department, form]);

  const createDept = useMutation({
    mutationFn: async (data: DepartmentFormValues) => {
      const r = await authFetch("/api/ops/departments", { method: "POST", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to create department");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Department created" });
      queryClient.invalidateQueries({ queryKey: ["ops-departments"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to create department", variant: "destructive" }),
  });

  const updateDept = useMutation({
    mutationFn: async (data: DepartmentFormValues) => {
      const r = await authFetch(`/api/ops/departments/${department!.id}`, { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update department");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Department updated" });
      queryClient.invalidateQueries({ queryKey: ["ops-departments"] });
      onClose();
    },
    onError: () => toast({ title: "Failed to update department", variant: "destructive" }),
  });

  const onSubmit = (data: DepartmentFormValues) => {
    if (department) {
      updateDept.mutate(data);
    } else {
      createDept.mutate(data);
    }
  };

  const isPending = createDept.isPending || updateDept.isPending;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={department ? "Edit Department" : "New Department"}
      description={department ? "Update department details" : "Create a new department for the team"}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Engineering" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description (Optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="What does this department do?" rows={3} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {department && (
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Active</FormLabel>
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
              {isPending ? "Saving..." : department ? "Save Changes" : "Create Department"}
            </Button>
          </FormDialogFooter>
        </form>
      </Form>
    </FormDialog>
  );
}
