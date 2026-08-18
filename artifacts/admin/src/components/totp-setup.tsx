/**
 * TotpSetup — inline 2FA setup/disable card for the account security page.
 *
 * States:
 *   idle      — shows current 2FA status + enable/disable button
 *   scanning  — shows QR code + secret so user can add to authenticator app
 *   verifying — user enters the 6-digit code to confirm the scan worked
 */
import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useAdminTotpSetup,
  useAdminTotpVerifySetup,
  useAdminTotpDisable,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldOff, Eye, EyeOff, Copy, Check } from "lucide-react";

type Step = "idle" | "scanning" | "verifying" | "disabling";

const codeSchema = z.object({
  code: z.string().length(6, "Enter the 6-digit code"),
});
const disableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

interface Props {
  totpEnabled: boolean;
  onChanged: () => void; // called after enable/disable so the parent can refetch
}

export function TotpSetup({ totpEnabled, onChanged }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("idle");
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Setup mutation — fetches secret + QR code ─────────────────────────────
  const setupMutation = useAdminTotpSetup({
    mutation: {
      onSuccess: (data) => {
        setSetupData({ secret: data.secret, qrCode: data.qrCode });
        setStep("scanning");
      },
      onError: () => {
        toast({ title: "Error", description: "Could not start 2FA setup.", variant: "destructive" });
      },
    },
  });

  // ── Verify-setup mutation — confirms scanned code + saves secret ──────────
  const verifyForm = useForm<z.infer<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: "" },
  });

  const verifyMutation = useAdminTotpVerifySetup({
    mutation: {
      onSuccess: () => {
        toast({ title: "2FA enabled", description: "Your account is now protected by two-factor authentication." });
        setStep("idle");
        setSetupData(null);
        onChanged();
      },
      onError: (err) => {
        toast({ title: "Code incorrect", description: err.message || "Try again.", variant: "destructive" });
        verifyForm.setValue("code", "");
      },
    },
  });

  // ── Disable mutation ──────────────────────────────────────────────────────
  const disableForm = useForm<z.infer<typeof disableSchema>>({
    resolver: zodResolver(disableSchema),
    defaultValues: { password: "" },
  });

  const disableMutation = useAdminTotpDisable({
    mutation: {
      onSuccess: () => {
        toast({ title: "2FA disabled", description: "Two-factor authentication has been removed from your account." });
        setStep("idle");
        disableForm.reset();
        onChanged();
      },
      onError: (err) => {
        toast({ title: "Could not disable 2FA", description: err.message || "Check your password.", variant: "destructive" });
      },
    },
  });

  function copySecret() {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render: idle ──────────────────────────────────────────────────────────
  if (step === "idle") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${totpEnabled ? "bg-green-100 dark:bg-green-950/40" : "bg-muted"}`}>
              {totpEnabled
                ? <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                : <ShieldOff className="h-5 w-5 text-muted-foreground" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <CardTitle>Two-Factor Authentication</CardTitle>
                <Badge variant={totpEnabled ? "default" : "secondary"} className="text-xs">
                  {totpEnabled ? "Enabled" : "Not enabled"}
                </Badge>
              </div>
              <CardDescription>
                {totpEnabled
                  ? "Your account requires an authenticator code on every sign-in."
                  : "Add a second layer of protection using Google Authenticator or any TOTP app."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {totpEnabled ? (
            <Button variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => setStep("disabling")}>
              Disable 2FA
            </Button>
          ) : (
            <Button onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
              {setupMutation.isPending ? "Setting up..." : "Enable 2FA"}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Render: QR code scanning ──────────────────────────────────────────────
  if (step === "scanning" && setupData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Scan the QR code</CardTitle>
          <CardDescription>
            Open Google Authenticator (or any TOTP app) and scan the code below. Then click Continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex justify-center">
            <img
              src={setupData.qrCode}
              alt="TOTP QR code"
              className="rounded-xl border border-border w-48 h-48"
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Can't scan? Enter this code manually:</p>
            <div className="flex items-center gap-2">
              <code className={`flex-1 text-sm font-mono tracking-wider select-all ${showSecret ? "" : "blur-sm"}`}>
                {setupData.secret}
              </code>
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title={showSecret ? "Hide" : "Reveal"}
              >
                {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={copySecret}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Copy"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setStep("idle"); setSetupData(null); }}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => setStep("verifying")}>
              Continue
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Render: verify the first code ─────────────────────────────────────────
  if (step === "verifying" && setupData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirm your code</CardTitle>
          <CardDescription>
            Enter the 6-digit code your authenticator app shows now to confirm the setup worked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...verifyForm}>
            <form
              onSubmit={verifyForm.handleSubmit((v) =>
                verifyMutation.mutate({ data: { code: v.code, secret: setupData.secret } })
              )}
              className="space-y-5"
            >
              <FormField
                control={verifyForm.control}
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
                        className="h-10 text-center tracking-widest text-lg font-mono"
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ""))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("scanning")}>
                  ← Back
                </Button>
                <Button type="submit" className="flex-1" disabled={verifyMutation.isPending}>
                  {verifyMutation.isPending ? "Verifying..." : "Activate 2FA"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    );
  }

  // ── Render: disable confirmation ──────────────────────────────────────────
  if (step === "disabling") {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Disable two-factor authentication</CardTitle>
          <CardDescription>
            Enter your password to confirm. You will no longer need an authenticator code to sign in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...disableForm}>
            <form
              onSubmit={disableForm.handleSubmit((v) =>
                disableMutation.mutate({ data: { password: v.password } })
              )}
              className="space-y-5"
            >
              <FormField
                control={disableForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" className="h-10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => { setStep("idle"); disableForm.reset(); }}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" className="flex-1" disabled={disableMutation.isPending}>
                  {disableMutation.isPending ? "Disabling..." : "Disable 2FA"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    );
  }

  return null;
}
