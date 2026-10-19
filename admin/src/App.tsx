import { Navigate, Outlet, Route, Routes, useParams } from "react-router";
import { useAuth } from "./state/auth";
import { StatsProvider } from "./state/stats";
import { Layout } from "./components/Layout";
import { Login, AcceptInvite, Register } from "./pages/Auth";
import { Account } from "./pages/Account";
import { Requests } from "./pages/Requests";
import { Setup } from "./pages/Setup";
import { Dashboard } from "./pages/Dashboard";
import { Live } from "./pages/Live";
import { Events } from "./pages/Events";
import { Funnels } from "./pages/Funnels";
import { Retention } from "./pages/Retention";
import { Errors } from "./pages/Errors";
import { Sessions } from "./pages/Sessions";
import { Replay } from "./pages/Replay";
import { Persons, PersonPage } from "./pages/Persons";
import { Sql } from "./pages/Sql";
import { Settings } from "./pages/Settings";
import { Team } from "./pages/Team";
import { NewProject, NewOrg } from "./pages/NewProject";
import { System } from "./pages/System";
import { Wordmark } from "./components/Logo";
import { Empty, Button } from "./components/ui";
import { Link } from "react-router";

function Splash() {
  return <div className="flex h-full items-center justify-center"><div className="pulse"><Wordmark size={36} /></div></div>;
}

function Protected() {
  const { loading, me, needsSetup } = useAuth();
  if (loading) return <Splash />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function Home() {
  const { me } = useAuth();
  const p = me?.projects[0];
  if (p) return <Navigate to={`/p/${p.id}`} replace />;
  const o = me?.orgs[0];
  if (o) return <Navigate to={`/org/${o.id}/new-project`} replace />;
  return <Navigate to="/org/new" replace />;
}

function ProjectGuard() {
  const { id } = useParams();
  const { me } = useAuth();
  if (!me?.projects.some((p) => p.id === id)) return <Empty title="Project not found" body="It may have been deleted, or you may not have access." action={<Link to="/" className="btn">Go home</Link>} />;
  return (
    <StatsProvider>
      <Outlet />
    </StatsProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/p/:id" element={<ProjectGuard />}>
          <Route index element={<Dashboard />} />
          <Route path="live" element={<Live />} />
          <Route path="events" element={<Events />} />
          <Route path="funnels" element={<Funnels />} />
          <Route path="retention" element={<Retention />} />
          <Route path="errors" element={<Errors />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:sid" element={<Replay />} />
          <Route path="persons" element={<Persons />} />
          <Route path="persons/:did" element={<PersonPage />} />
          <Route path="sql" element={<Sql />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="/org/new" element={<NewOrg />} />
        <Route path="/org/:org/team" element={<Team />} />
        <Route path="/org/:org/new-project" element={<NewProject />} />
        <Route path="/system" element={<System />} />
        <Route path="/account" element={<Account />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="*" element={<Empty title="Page not found" action={<Link to="/"><Button>Go home</Button></Link>} />} />
      </Route>
    </Routes>
  );
}
