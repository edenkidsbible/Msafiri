import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminLogin, useAdminTotpConfirm } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { setToken, getToken, getUser } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { getDefaultRoute } from "@/lib/permission-routes";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password is required"),
});

const totpSchema = z.object({
  code: z.string().length(6, "Enter the 6-digit code from your authenticator app"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = getToken();
  const queryClient = useQueryClient();
  const { effectivePermissions, isLoading } = usePermissions();

  // When TOTP is required, we hold the pending token and switch to the code step.
  const [pendingToken, setPendingToken] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const user = getUser();
    if (user?.mustChangePassword) {
      setLocation("/change-password");
      return;
    }
    if (isLoading) return;
    const fallback = getDefaultRoute(effectivePermissions);
    if (fallback) setLocation(fallback);
  }, [token, setLocation, isLoading, effectivePermissions]);

  // ── Step 1: email + password ──────────────────────────────────────────────
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess: (data) => {
        if (data.totpRequired && data.pendingToken) {
          setPendingToken(data.pendingToken);
          return;
        }
        if (!data.token || !data.user) return;
        handleSessionGranted(data.token, data.user);
      },
      onError: (error) => {
        toast({
          title: "Sign in failed",
          description: error.message || "Invalid email or password.",
          variant: "destructive",
        });
      },
    },
  });

  // ── Step 2: TOTP code ─────────────────────────────────────────────────────
  const totpForm = useForm<z.infer<typeof totpSchema>>({
    resolver: zodResolver(totpSchema),
    defaultValues: { code: "" },
  });

  const totpMutation = useAdminTotpConfirm({
    mutation: {
      onSuccess: (data) => {
        if (!data.token || !data.user) return;
        handleSessionGranted(data.token, data.user);
      },
      onError: (error) => {
        toast({
          title: "Wrong code",
          description: error.message || "Check your authenticator app and try again.",
          variant: "destructive",
        });
        totpForm.setValue("code", "");
      },
    },
  });

  function handleSessionGranted(token: string, user: any) {
    setToken(token);
    if (user.mustChangePassword) {
      toast({
        title: "Password change required",
        description: "Please set a new password before continuing.",
      });
      setLocation("/change-password");
      return;
    }
    queryClient.setQueryData(["/api/admin/auth/me"], {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword ?? false,
      effectivePermissions: user.effectivePermissions ?? [],
    });
    toast({ title: "Sign in successful", description: "Welcome back to Msafiri Ops." });
    const fallback = getDefaultRoute((user.effectivePermissions ?? []) as any);
    setLocation(fallback ?? "/");
  }

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values });
  };

  const onTotpSubmit = (values: z.infer<typeof totpSchema>) => {
    if (!pendingToken) return;
    totpMutation.mutate({ data: { pendingToken, code: values.code } });
  };

  // ── TOTP step ─────────────────────────────────────────────────────────────
  if (pendingToken) {
    return (
      <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-[400px]">
          <div className="flex flex-col items-center mb-10">
            <div className="h-14 w-14 bg-white dark:bg-zinc-900 rounded-xl shadow-sm flex items-center justify-center mb-5 border border-border">
              <img src={logo} alt="Msafiri" className="h-9 w-9" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Two-factor verification</h1>
            <p className="text-muted-foreground text-sm mt-1.5 text-center">
              Open your authenticator app and enter the 6-digit code.
            </p>
          </div>

          <Card className="border-border/60 shadow-lg bg-card">
            <CardHeader className="space-y-1.5 pb-6">
              <CardTitle className="text-xl">Enter your code</CardTitle>
              <CardDescription>The code refreshes every 30 seconds.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...totpForm}>
                <form onSubmit={totpForm.handleSubmit(onTotpSubmit)} className="space-y-5">
                  <FormField
                    control={totpForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Authenticator code</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="000000"
                            maxLength={6}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            className="bg-background h-10 text-center tracking-widest text-lg font-mono"
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full h-10 mt-2 font-medium"
                    disabled={totpMutation.isPending}
                  >
                    {totpMutation.isPending ? "Verifying..." : "Verify and sign in"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full h-9 text-muted-foreground text-sm"
                    onClick={() => { setPendingToken(null); totpForm.reset(); }}
                  >
                    ← Back to sign in
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── Password step (default) ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/30 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-10">
          <div className="h-14 w-14 bg-white dark:bg-zinc-900 rounded-xl shadow-sm flex items-center justify-center mb-5 border border-border">
            <img src={logo} alt="Msafiri" className="h-9 w-9" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Msafiri Operations</h1>
          <p className="text-muted-foreground text-sm mt-1.5">Internal safety management platform</p>
        </div>

        <Card className="border-border/60 shadow-lg bg-card">
          <CardHeader className="space-y-1.5 pb-6">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Enter your team credentials to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work Email</FormLabel>
                      <FormControl>
                        <Input placeholder="name@msafiri.co.ke" {...field} className="bg-background h-10" data-testid="input-email" />
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
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="bg-background h-10" data-testid="input-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full h-10 mt-2 font-medium"
                  disabled={loginMutation.isPending}
                  data-testid="btn-login"
                >
                  {loginMutation.isPending ? "Signing in..." : "Sign in to Operations"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
