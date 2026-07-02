import { useEffect } from "react";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminLogin } from "@workspace/api-client-react";
import { setToken, getToken, getUser } from "@/lib/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { MapPin, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password is required"),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = getToken();

  useEffect(() => {
    if (token) {
      const user = getUser();
      setLocation(user?.role === "admin" ? "/dashboard" : "/reports");
    }
  }, [token, setLocation]);

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
        const user = getUser();
        toast({
          title: "Sign in successful",
          description: "Welcome back to Msafiri Ops.",
        });
        setLocation(user?.role === "admin" ? "/dashboard" : "/reports");
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
            <MapPin className="h-7 w-7 text-primary" />
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
