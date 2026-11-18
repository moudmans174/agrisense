import { useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loader } from './ui.jsx';

export const Logo = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <rect width="64" height="64" rx="14" fill="#1F3B2D" />
    <path d="M32 50c0-14 6-24 18-28-2 14-8 24-18 28z" fill="#8BC34A" />
    <path d="M32 50c0-10-5-18-15-21 1 11 6 18 15 21z" fill="#E9C46A" />
    <circle cx="46" cy="14" r="4" fill="#E9C46A" />
  </svg>
);

export function PublicLayout() {
  const { user } = useAuth();
  return (
    <>
      <header className="pub-nav">
        <div className="inner">
          <Link to="/" className="brand"><Logo /> AgriSense</Link>
          <nav className="links">
            <NavLink to="/platform">Platform</NavLink>
            <NavLink to="/tools">Free tools</NavLink>
            <NavLink to="/advisories">Advisories</NavLink>
            <NavLink to="/about">About</NavLink>
            <NavLink to="/contact">Contact</NavLink>
          </nav>
          <span className="spacer" />
          {user ? <Link className="btn" to="/app">Open dashboard</Link> : (
            <>
              <Link className="btn ghost" to="/login">Sign in</Link>
              <Link className="btn" to="/register">Get started</Link>
            </>
          )}
        </div>
      </header>
      <Outlet />
      <footer className="pub-footer">
        <div className="container">
          <div className="cols">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700 }}><Logo size={24} /> AgriSense</div>
              <p style={{ marginTop: 10, maxWidth: 340 }}>Integrating field observations, satellite and environmental data for AI-enabled agricultural decisions.</p>
            </div>
            <div><strong style={{ color: '#fff' }}>Platform</strong><p><Link to="/platform">How it works</Link><br /><Link to="/tools">Free tools</Link><br /><Link to="/advisories">Advisories</Link></p></div>
            <div><strong style={{ color: '#fff' }}>Company</strong><p><Link to="/about">About</Link><br /><Link to="/contact">Contact</Link></p></div>
            <div><strong style={{ color: '#fff' }}>Account</strong><p><Link to="/login">Sign in</Link><br /><Link to="/register">Create account</Link></p></div>
          </div>
          <p className="small" style={{ marginTop: 24 }}>© {new Date().getFullYear()} AgriSense. Weather data: Open-Meteo. Imagery: Copernicus Sentinel-2.</p>
        </div>
      </footer>
    </>
  );
}

const NAV = [
  { section: 'Overview' },
  { to: '/app', label: 'Dashboard', ico: '◧', end: true },
  { to: '/app/insights', label: 'AI insights', ico: '✦' },
  { to: '/app/alerts', label: 'Alerts', ico: '⚑' },
  { section: 'Farm data' },
  { to: '/app/farms', label: 'Farms', ico: '⌂' },
  { to: '/app/fields', label: 'Fields', ico: '▦' },
  { to: '/app/observations', label: 'Field observations', ico: '✎' },
  { to: '/app/satellite', label: 'Satellite data', ico: '◎' },
  { to: '/app/environment', label: 'Weather & climate', ico: '☁' },
  { section: 'Analysis' },
  { to: '/app/reports', label: 'Reports', ico: '▤' },
  { to: '/app/models', label: 'Yield models', ico: '∿' },
  { section: 'Administration', staff: true },
  { to: '/app/advisories', label: 'Public advisories', ico: '✉', staff: true },
  { to: '/app/users', label: 'Users & messages', ico: '☺', admin: true },
];

export function AppLayout() {
  const { user, loading, logout, isStaff, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  const items = NAV.filter((n) => (!n.staff || isStaff) && (!n.admin || isAdmin));
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
        <Link to="/" className="brand"><Logo /> AgriSense</Link>
        <nav>
          {items.map((n, i) => (n.section
            ? <div className="section" key={i}>{n.section}</div>
            : <NavLink key={n.to} to={n.to} end={n.end} className="nav"><span className="ico">{n.ico}</span>{n.label}</NavLink>))}
        </nav>
        <div className="user">
          <div style={{ color: '#fff', fontWeight: 600 }}>{user.name}</div>
          <div style={{ color: '#8fa797', textTransform: 'capitalize' }}>{user.role}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Link to="/app/profile" className="btn sm secondary">Profile</Link>
            <button className="btn sm wheat" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>
      <div>
        <div className="mobile-bar"><button className="btn sm wheat" onClick={() => setOpen(!open)}>☰</button><strong>AgriSense</strong></div>
        <main className="main"><Outlet /></main>
      </div>
    </div>
  );
}
