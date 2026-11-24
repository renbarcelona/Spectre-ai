import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listTeamAccounts, createTeamAccount, updateTeamAccount, deleteTeamAccount, getListTeamAccountsQueryKey } from "@workspace/api-client-react";

export type TeamRole = "admin" | "readonly";
export interface TeamAccount {
  id: string;
  username: string;
  displayName: string;
  role: TeamRole;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
export interface TeamAuthStatus { setupRequired: boolean; setupReady: boolean; user: TeamAccount | null }

export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,79}$/;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const TEAM_STATUS_KEY = ["team-auth", "status"] as const;
export const TEAM_USERS_KEY = getListTeamAccountsQueryKey();

export class TeamAuthError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      credentials: "include",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new TeamAuthError(0, "Could not reach the SPECTRE API. Check the connection and retry.");
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string")
      ? (data as { error: string }).error
      : res.status === 429 ? "Too many attempts. Wait a minute before trying again."
      : `Request failed (${res.status}).`;
    throw new TeamAuthError(res.status, msg);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "data" in e && "status" in e) {
    const d = (e as { data: unknown; status: number }).data;
    if (d && typeof d === "object" && typeof (d as { error?: unknown }).error === "string") return (d as { error: string }).error;
    if ((e as { status: number }).status === 429) return "Too many attempts. Wait a minute before trying again.";
  }
  if (e instanceof TeamAuthError) return e.status === 429 && !/wait|many/i.test(e.message) ? `${e.message} Too many attempts; wait before retrying.` : e.message;
  return e instanceof Error ? e.message : "Unexpected error.";
}

/** Drop every cached query except auth status so no data from a previous identity survives. */
export function clearPrivateCaches(qc: QueryClient) {
  qc.cancelQueries({ predicate: (q) => q.queryKey[0] !== "team-auth" });
  qc.removeQueries({ predicate: (q) => !(q.queryKey[0] === "team-auth" && q.queryKey[1] === "status") });
}

interface Ctx {
  status: TeamAuthStatus | undefined;
  user: TeamAccount | null;
  isAdmin: boolean;
  isReadOnly: boolean;
  logout: () => Promise<void>;
  loggingOut: boolean;
}
const TeamAuthContext = createContext<Ctx | null>(null);

export function useTeamAuthStatus() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: TEAM_STATUS_KEY,
    queryFn: async () => {
      const next = await api<TeamAuthStatus>("/team-auth/status");
      const previous = qc.getQueryData<TeamAuthStatus>(TEAM_STATUS_KEY);
      const identity = (s?: TeamAuthStatus) => s?.user ? `${s.user.id}:${s.user.role}:${s.user.active}:${s.user.mustChangePassword}` : "anon";
      // Clear before publishing the new identity, not after its children start fetching.
      if (previous && identity(previous) !== identity(next)) clearPrivateCaches(qc);
      return next;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
    staleTime: 5_000,
  });
}

export function TeamAuthProvider({ status, children }: { status: TeamAuthStatus | undefined; children: ReactNode }) {
  const qc = useQueryClient();
  const user = status?.user ?? null;
  const logoutM = useMutation({ mutationFn: () => api<unknown>("/team-auth/logout", { method: "POST", body: {} }) });
  const logout = async () => {
    await logoutM.mutateAsync(); // throws on failure; caller surfaces the error and the session is left intact
    clearPrivateCaches(qc);
    qc.setQueryData<TeamAuthStatus>(TEAM_STATUS_KEY, (o) => (o ? { ...o, user: null } : o));
    await qc.invalidateQueries({ queryKey: TEAM_STATUS_KEY });
  };

  return (
    <TeamAuthContext.Provider value={{ status, user, isAdmin: user?.role === "admin", isReadOnly: user?.role !== "admin", logout, loggingOut: logoutM.isPending }}>
      {children}
    </TeamAuthContext.Provider>
  );
}

export function useTeamAuth(): Ctx {
  const c = useContext(TeamAuthContext);
  if (!c) throw new Error("useTeamAuth must be used inside TeamAuthProvider");
  return c;
}

/** Write actions are allowed only for active admins. */
export function useCanWrite() { return useTeamAuth().isAdmin; }

function useApplySession() {
  const qc = useQueryClient();
  return (acct: TeamAccount) => {
    clearPrivateCaches(qc);
    qc.setQueryData<TeamAuthStatus>(TEAM_STATUS_KEY, (o) => ({ setupRequired: false, setupReady: o?.setupReady ?? false, user: acct }));
    qc.invalidateQueries({ queryKey: TEAM_STATUS_KEY });
  };
}

export function useLogin() {
  const apply = useApplySession();
  return useMutation({
    mutationFn: (b: { username: string; password: string }) => api<TeamAccount>("/team-auth/login", { method: "POST", body: b }),
    onSuccess: apply,
  });
}

export function useSetupAdmin() {
  const apply = useApplySession();
  return useMutation({
    mutationFn: (b: { setupCode: string; username: string; displayName: string; password: string }) =>
      api<TeamAccount>("/team-auth/setup", { method: "POST", body: { ...b, role: "admin" } }),
    onSuccess: apply,
  });
}

export function useChangeOwnPassword() {
  const apply = useApplySession();
  return useMutation({
    mutationFn: (b: { currentPassword: string; newPassword: string }) => api<TeamAccount>("/team-auth/password", { method: "POST", body: b }),
    onSuccess: apply,
  });
}

/* Administrator account management via generated client functions (shared contract). */
export function useTeamAccounts(enabled: boolean) {
  return useQuery({ queryKey: TEAM_USERS_KEY, queryFn: () => listTeamAccounts() as Promise<TeamAccount[]>, enabled, refetchInterval: enabled ? 15_000 : false });
}
export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { username: string; displayName: string; role: TeamRole; password: string }) => createTeamAccount(b) as Promise<TeamAccount>,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_USERS_KEY }),
  });
}
export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { displayName?: string; role?: TeamRole; active?: boolean; password?: string } }) =>
      updateTeamAccount(id, data) as Promise<TeamAccount>,
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_USERS_KEY }),
  });
}
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTeamAccount(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: TEAM_USERS_KEY }),
  });
}

export function passwordIssue(pw: string, confirm: string): string | null {
  if (pw.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `At most ${PASSWORD_MAX} characters.`;
  if (confirm !== pw) return "Passwords do not match.";
  return null;
}
