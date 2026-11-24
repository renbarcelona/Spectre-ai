import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Dashboard from '@/pages/dashboard';
import Scans from '@/pages/scans';
import Vulnerabilities from '@/pages/vulnerabilities';
import Reports from '@/pages/reports';
import Investigator from '@/pages/investigator';
import Simulations from '@/pages/simulations';
import SettingsPage from '@/pages/settings';
import { Shell } from '@/components/shell';
import { TeamAuthProvider, useTeamAuthStatus, errorMessage } from '@/lib/team-auth';
import { AuthLoading, AuthUnavailable, LoginScreen, SetupScreen, ForcedChangeScreen } from '@/components/auth/auth-screens';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

import { FeatureProvider, FeatureGuard } from "@/lib/features";

function Router() {
  return (
    <FeatureProvider><Shell>
      <RoutedErrorBoundary>
        <FeatureGuard>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/scans" component={Scans} />
          <Route path="/vulnerabilities" component={Vulnerabilities} />
          <Route path="/reports" component={Reports} />
          <Route path="/investigator" component={Investigator} />
          <Route path="/simulations" component={Simulations} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
        </FeatureGuard>
      </RoutedErrorBoundary>
    </Shell></FeatureProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AuthGate() {
  const status = useTeamAuthStatus();
  const data = status.data;
  let body: ReactNode;
  if (!data) body = status.isError
    ? <AuthUnavailable message={errorMessage(status.error)} onRetry={() => status.refetch()} retrying={status.isFetching} />
    : <AuthLoading />;
  else if (!data.user) body = data.setupRequired ? <SetupScreen status={data} /> : <LoginScreen />;
  else if (!data.user.active) body = <LoginScreen />;
  else if (data.user.mustChangePassword) body = <ForcedChangeScreen />;
  else body = <Router key={`${data.user.id}:${data.user.role}`} />;
  return <TeamAuthProvider status={data}>{body}</TeamAuthProvider>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthGate />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
