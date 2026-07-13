import { useEffect } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminLogin } from "@workspace/api-client-react";
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

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = getToken();
  const queryClient = useQueryClient();
  const { effectivePermissions, isLoading } = usePermissions();

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

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess: (data) => {
        setToken(data.token);
        if (data.user.mustChangePassword) {
          toast({
            title: "Password change required",
            description: "Please set a new password before continuing.",
          });
          setLocation("/change-password");
          return;
        }
        // Prime the shared /admin/auth/me cache with what the login
        // response already told us, so the redirect below (and the layout
        // that mounts right after it) has real effectivePermissions on the
        // very first render instead of waiting on a second network round
        // trip or falling back to a hardcoded route guess.
        queryClient.setQueryData(["/api/admin/auth/me"], {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          role: data.user.role,
          mustChangePassword: data.user.mustChangePassword ?? false,
          effectivePermissions: data.user.effectivePermissions ?? [],
        });
        toast({
          title: "Sign in successful",
          description: "Welcome back to Msafiri Ops.",
        });
        // "/" re-evaluates via RootRedirect, which shows a "no access"
        // screen instead of bouncing into another denied route when the
        // account has no accessible feature at all.
        const fallback = getDefaultRoute((data.user.effectivePermissions ?? []) as any);
        setLocation(fallback ?? "/");
      },
      onError: (error) => {
        toast({
          title: "Sign in failed",
          description: error.message || "Invalid email or password.",
          variant: "destructive",
        });
      },
    }
  });

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values });
  };

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
