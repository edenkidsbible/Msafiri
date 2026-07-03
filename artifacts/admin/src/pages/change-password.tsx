import { useEffect } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminChangePassword } from "@workspace/api-client-react";
import { setToken, getToken, getUser } from "@/lib/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export default function ChangePassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = getToken();
  const user = getUser();

  useEffect(() => {
    if (!token || !user) {
      setLocation("/login");
    }
  }, [token, user, setLocation]);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const changePasswordMutation = useAdminChangePassword({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        toast({
          title: "Password updated",
          description: "Your password has been changed successfully.",
        });
        setLocation(data.user.role === "admin" ? "/dashboard" : "/reports");
      },
      onError: (error: any) => {
        toast({
          title: "Could not change password",
          description: error?.message || "Check your current password and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const onSubmit = (values: z.infer<typeof schema>) => {
    changePasswordMutation.mutate({
      data: { currentPassword: values.currentPassword, newPassword: values.newPassword },
    });
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-10">
          <div className="h-14 w-14 bg-white dark:bg-zinc-900 rounded-xl shadow-sm flex items-center justify-center mb-5 border border-border">
            <img src={logo} alt="Msafiri" className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Set a New Password</h1>
          <p className="text-muted-foreground text-sm mt-1.5 text-center">
            {user?.mustChangePassword
              ? "For security, you must set a new password before continuing."
              : "Update your account password."}
          </p>
        </div>

        <Card className="border-border/60 shadow-lg bg-card">
          <CardHeader className="space-y-1.5 pb-6">
            <CardTitle className="text-xl">Change Password</CardTitle>
            <CardDescription>Choose a strong password you haven't used before.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="bg-background h-10" data-testid="input-current-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="At least 8 characters" {...field} className="bg-background h-10" data-testid="input-new-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="bg-background h-10" data-testid="input-confirm-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full h-10 mt-2 font-medium"
                  disabled={changePasswordMutation.isPending}
                  data-testid="btn-change-password"
                >
                  {changePasswordMutation.isPending ? "Updating..." : "Update Password"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
