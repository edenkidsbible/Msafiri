import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAdminGlobalSearch } from "@workspace/api-client-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AlertCircle, Star, CreditCard, Users, Loader2 } from "lucide-react";

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [open]);

  const { data, isFetching } = useAdminGlobalSearch(
    { q: debouncedQuery },
    { query: { queryKey: ["/api/admin/search", debouncedQuery], enabled: debouncedQuery.length >= 2, staleTime: 10000 } }
  );

  const go = (path: string) => {
    onOpenChange(false);
    setLocation(path);
  };

  const hasResults =
    !!data && (data.reports.length + data.creators.length + data.subscribers.length + data.users.length) > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search reports, creator applications, subscribers, team members…"
        value={query}
        onValueChange={setQuery}
        data-testid="input-global-search"
      />
      <CommandList>
        {debouncedQuery.length < 2 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Type at least 2 characters to search.</div>
        ) : isFetching ? (
          <div className="py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </div>
        ) : !hasResults ? (
          <CommandEmpty>No results for "{debouncedQuery}".</CommandEmpty>
        ) : (
          <>
            {data!.reports.length > 0 && (
              <CommandGroup heading="Incident Reports">
                {data!.reports.map((r) => (
                  <CommandItem
                    key={r.id}
                    value={`report-${r.id}`}
                    onSelect={() => go(`/reports?highlight=${r.id}&q=${r.id}`)}
                    data-testid={`search-result-report-${r.id}`}
                  >
                    <AlertCircle className="text-muted-foreground" />
                    <span className="capitalize">{r.type}</span>
                    {r.roadName && <span className="text-muted-foreground">— {r.roadName}</span>}
                    <span className="ml-auto text-xs text-muted-foreground capitalize">{r.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data!.creators.length > 0 && (
              <CommandGroup heading="Creator Applications">
                {data!.creators.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`creator-${c.id}`}
                    onSelect={() => go(`/creators?highlight=${c.id}`)}
                    data-testid={`search-result-creator-${c.id}`}
                  >
                    <Star className="text-muted-foreground" />
                    <span>{c.name || c.email}</span>
                    <span className="text-muted-foreground">— {c.email}</span>
                    <span className="ml-auto text-xs text-muted-foreground capitalize">{c.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data!.subscribers.length > 0 && (
              <CommandGroup heading="Subscribers">
                {data!.subscribers.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`subscriber-${s.id}`}
                    onSelect={() => go(`/subscribers?highlight=${s.appUserId}`)}
                    data-testid={`search-result-subscriber-${s.id}`}
                  >
                    <CreditCard className="text-muted-foreground" />
                    <span className="font-mono text-sm">{s.appUserId}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {s.hasActiveEntitlement ? "Active" : "Inactive"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {data!.users.length > 0 && (
              <CommandGroup heading="Team Members">
                {data!.users.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={`user-${u.id}`}
                    onSelect={() => go(`/users?highlight=${u.id}`)}
                    data-testid={`search-result-user-${u.id}`}
                  >
                    <Users className="text-muted-foreground" />
                    <span>{u.name}</span>
                    <span className="text-muted-foreground">— {u.email}</span>
                    <span className="ml-auto text-xs text-muted-foreground capitalize">{u.role}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
