import { useTeamAuth } from "./team-auth";
export function useAuth() {
  const {user, status, logout}=useTeamAuth();
  return {
    user:user ? {...user, firstName:user.displayName, lastName:"", email:user.username} : null,
    isLoading:!status, isAuthenticated:!!user,
    login:()=>window.location.assign("/"), logout
  };
}
