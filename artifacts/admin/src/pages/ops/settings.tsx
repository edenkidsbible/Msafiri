import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Settings2, RefreshCw, Lock, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function ChangePasswordCard() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, string> = { newPassword, currentPassword };
      const res = await authFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to update password");
        return;
      }
      toast({ title: "Password updated", description: "You can use your new password next time you log in." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" />
          Change Password
        </CardTitle>
        <CardDescription>Update your login password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                onClick={() => setShowCurrent(v => !v)}
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                onClick={() => setShowNew(v => !v)}
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <Button type="submit" disabled={loading} className="gap-2">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["ops-settings"],
    queryFn: async () => {
      const r = await authFetch("/api/ops/settings");
      if (!r.ok) throw new Error("Failed to fetch settings");
      return r.json();
    },
  });

  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) setFormData(settings);
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const r = await authFetch("/api/ops/settings", { method: "PATCH", body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed to update settings");
      return r.json();
    },
    onSuccess: () => toast({ title: "Settings Saved", description: "Business assumptions updated." }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => updateSettingsMutation.mutate(formData);

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-48" /><Skeleton className="h-[500px] w-full" /></div>;
  }

  return (
    <div className="space-y-8 animate-in max-w-4xl">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">Core business assumptions and parameters.</p>
        </div>
        <Button onClick={handleSave} disabled={updateSettingsMutation.isPending} className="gap-2">
          {updateSettingsMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Financial Baseline
            </CardTitle>
            <CardDescription>Core money rules</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="weeklyFundingAmountKes">Weekly Funding (KES)</Label>
              <Input
                id="weeklyFundingAmountKes"
                name="weeklyFundingAmountKes"
                value={formData.weeklyFundingAmountKes || ''}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cashFloorKes">Cash Floor (KES)</Label>
              <Input
                id="cashFloorKes"
                name="cashFloorKes"
                value={formData.cashFloorKes || ''}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reserveTransferTargetKes">Reserve Target (KES)</Label>
              <Input
                id="reserveTransferTargetKes"
                name="reserveTransferTargetKes"
                value={formData.reserveTransferTargetKes || ''}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exchangeRateKesPerUsd">Exchange Rate (KES/USD)</Label>
              <Input
                id="exchangeRateKesPerUsd"
                name="exchangeRateKesPerUsd"
                value={formData.exchangeRateKesPerUsd || ''}
                onChange={handleChange}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-primary" />
              Product & Field
            </CardTitle>
            <CardDescription>Metrics and real-world costs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="monthlySubscriptionPriceKes">Monthly Sub Price (KES)</Label>
              <Input
                id="monthlySubscriptionPriceKes"
                name="monthlySubscriptionPriceKes"
                value={formData.monthlySubscriptionPriceKes || ''}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baselineActivePaid">Baseline Active Paid</Label>
              <Input
                id="baselineActivePaid"
                name="baselineActivePaid"
                type="number"
                value={formData.baselineActivePaid || ''}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fuelPricePerLitreKes">Fuel Price / Litre (KES)</Label>
              <Input
                id="fuelPricePerLitreKes"
                name="fuelPricePerLitreKes"
                value={formData.fuelPricePerLitreKes || ''}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vehicleEfficiencyKmPerLitre">Vehicle Efficiency (km/L)</Label>
              <Input
                id="vehicleEfficiencyKmPerLitre"
                name="vehicleEfficiencyKmPerLitre"
                value={formData.vehicleEfficiencyKmPerLitre || ''}
                onChange={handleChange}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <ChangePasswordCard />
      </div>
    </div>
  );
}
