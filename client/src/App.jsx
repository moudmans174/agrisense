import { Routes, Route, Navigate } from 'react-router-dom';
import { PublicLayout, AppLayout } from './components/Layouts.jsx';
import { useAuth } from './context/AuthContext.jsx';
import Home from './pages/public/Home.jsx';
import { Platform, Tools, Advisories, About, Contact, Login, Register } from './pages/public/Pages.jsx';
import Dashboard from './pages/app/Dashboard.jsx';
import Farms, { FarmDetail } from './pages/app/Farms.jsx';
import Fields from './pages/app/Fields.jsx';
import FieldDetail from './pages/app/FieldDetail.jsx';
import Observations from './pages/app/Observations.jsx';
import Satellite from './pages/app/Satellite.jsx';
import Environment from './pages/app/Environment.jsx';
import Insights from './pages/app/Insights.jsx';
import { Alerts, Reports, Models, AdvisoriesAdmin, Users, Profile } from './pages/app/Manage.jsx';

function StaffOnly({ children, admin }) {
  const { isStaff, isAdmin } = useAuth();
  if (admin ? !isAdmin : !isStaff) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Home />} />
        <Route path="platform" element={<Platform />} />
        <Route path="tools" element={<Tools />} />
        <Route path="advisories" element={<Advisories />} />
        <Route path="about" element={<About />} />
        <Route path="contact" element={<Contact />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
      </Route>
      <Route path="app" element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="insights" element={<Insights />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="farms" element={<Farms />} />
        <Route path="farms/:id" element={<FarmDetail />} />
        <Route path="fields" element={<Fields />} />
        <Route path="fields/:id" element={<FieldDetail />} />
        <Route path="observations" element={<Observations />} />
        <Route path="satellite" element={<Satellite />} />
        <Route path="environment" element={<Environment />} />
        <Route path="reports" element={<Reports />} />
        <Route path="models" element={<Models />} />
        <Route path="advisories" element={<StaffOnly><AdvisoriesAdmin /></StaffOnly>} />
        <Route path="users" element={<StaffOnly admin><Users /></StaffOnly>} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
