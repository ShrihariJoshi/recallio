import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown, CircleHelp, ClipboardCheck, Command, House, Plus, Search, Settings2, Sparkles, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { authApi, statisticsApi } from "../api";
import { StudyActivityChart } from "../components/StudyActivityChart";
import { SyncStatus } from "../components/SyncStatus";

type Props = { user: PublicUser; onLogout: () => void };

export function HomePage({ user, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const statistics = useQuery({ queryKey: ["dashboard-statistics", 7], queryFn: () => statisticsApi.dashboard(7), staleTime: 60_000 });
  const metrics = statistics.data?.overview;
  async function logout() { await authApi.logout().catch(() => undefined); onLogout(); }

  return <main className="app-frame">
    <aside className="sidebar">
      <a className="brand sidebar-brand" href="/"><span className="brand-mark">r</span><span>recallio</span></a>
      <div className="side-label">YOUR SPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <a className="nav-link selected" href="/"><House className="nav-icon" size={17} />Home</a>
        <a className="nav-link" href="/decks"><BookOpen size={17} />Decks</a>
        <a className="nav-link" href="/browse"><Sparkles size={16} />Card browser</a>
        <Link className="nav-link" to="/statistics"><Sparkles size={16} />Statistics</Link>
        <Link className="nav-link" to="/assessments"><ClipboardCheck size={16} />Assessments</Link>
      </nav>
      <div className="sidebar-spacer" />
      <div className="help-link"><CircleHelp size={17} />Help & guidance</div>
      <div className="sidebar-footer"><span className="avatar">{user.name.charAt(0).toUpperCase()}</span><span className="user-meta"><strong>{user.name}</strong><small>{user.email}</small></span><button className="icon-button" aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}><ChevronDown size={16} /></button>{menuOpen && <div className="account-menu"><button onClick={logout}>Sign out</button></div>}</div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div className="breadcrumb">Your space <span>/</span> Home</div><div className="top-actions"><div className="search-trigger"><Search size={16} /><span>Search anything</span><kbd><Command size={11} /> K</kbd></div><SyncStatus userId={user.id} /><Settings2 className="settings-button" aria-label="Settings" size={18} /></div></header>
      <div className="home-content">
        <div className="greeting-row"><div><div className="date-label">YOUR LEARNING SPACE</div><h1>Good to have you here, {user.name.split(" ")[0]}.</h1><p>Build a little knowledge, one recall at a time.</p></div><button className="profile-chip"><span className="avatar avatar-small">{user.name.charAt(0).toUpperCase()}</span>{user.name}<ChevronDown size={15} /></button></div>
        <section className="welcome-card dashboard-welcome"><div className="welcome-copy"><div className="eyebrow welcome-eyebrow"><span className="welcome-dot" /> YOUR NEXT RECALL</div><h2>{metrics?.dueNow ? <>You have {metrics.dueNow}<br />cards ready to review.</> : <>Make a little progress<br />one card at a time.</>}</h2><p>{metrics ? metrics.dueNow ? "Take a focused session and set the next review as you go." : "You’re all caught up for now. Add a few questions or come back when they’re due." : statistics.error ? "Your study summary is unavailable right now, but you can still study." : "Your study activity and next reviews are loading."}</p><Link className="primary-action" to="/study">Study now <Plus size={16} /></Link></div><div className="welcome-visual" aria-hidden="true"><div className="visual-ring ring-a" /><div className="visual-ring ring-b" /><div className="visual-card"><span>Q</span><i /><i /><i className="short" /><div className="visual-card-foot"><span>RECALLIO</span><span>01</span></div></div><span className="visual-spark spark-a">✳</span><span className="visual-spark spark-b">✳</span></div></section>
        <section className="dashboard-stat-row" aria-label="Learning overview">
          <Link to="/study" className="dashboard-stat-card"><span className="dashboard-stat-label">DUE NOW</span><strong>{metrics?.dueNow ?? "—"}</strong><small>Cards ready to study</small></Link>
          <Link to="/study" className="dashboard-stat-card"><span className="dashboard-stat-label">NEW</span><strong>{metrics?.newCards ?? "—"}</strong><small>Cards not yet reviewed</small></Link>
          <Link to="/statistics" className="dashboard-stat-card"><span className="dashboard-stat-label">TODAY</span><strong>{metrics?.reviewsToday ?? "—"}</strong><small>Reviews completed</small></Link>
        </section>
        {statistics.data && <StudyActivityChart activity={statistics.data.activity} rangeReviews={statistics.data.rangeReviews} title="This week" compact />}
        {statistics.error && <p className="dashboard-stat-error" role="status">Your study summary couldn’t load. You can still start a session.</p>}
        <section className="quick-section" id="quick-actions"><div className="section-heading"><div><div className="date-label">YOUR LIBRARY</div><h3>Keep building your study space.</h3></div><Link className="dashboard-view-stats" to="/statistics">View statistics ↗</Link></div>
          <div className="action-grid"><a className="action-card" href="/decks"><span className="action-icon"><Plus size={18} /></span><span className="action-text"><strong>Create a deck</strong><small>Organize a subject or topic</small></span><span className="action-arrow">↗</span></a><a className="action-card" href="/add"><span className="action-icon import-icon"><Upload size={17} /></span><span className="action-text"><strong>Add text cards</strong><small>Create a Basic, reversed, or cloze note</small></span><span className="action-arrow">↗</span></a><Link className="action-card" to="/assessments"><span className="action-icon"><ClipboardCheck size={17} /></span><span className="action-text"><strong>Timed assessments</strong><small>Build exam style practice tests</small></span><span className="action-arrow">↗</span></Link></div>
        </section>
        <footer className="home-footer"><span>Made for the things worth remembering.</span><span>LEARN. RECALL. REPEAT.</span></footer>
      </div>
    </section>
    <nav className="mobile-nav" aria-label="Main navigation"><Link className="mobile-selected" to="/"><House size={18} />Home</Link><Link to="/decks"><BookOpen size={18} />Decks</Link><Link to="/assessments"><ClipboardCheck size={18} />Tests</Link><Link to="/statistics"><Sparkles size={18} />Stats</Link></nav>
  </main>;
}
