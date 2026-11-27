import { BookOpen, ChevronDown, CircleHelp, ClipboardCheck, House, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { authApi } from "../api";
import { SyncStatus } from "./SyncStatus";

export function WorkspaceLayout({ user, title, children }: { user: PublicUser; title: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  async function logout() { await authApi.logout().catch(() => undefined); localStorage.removeItem("recallio:offline-user"); navigate("/login", { replace: true }); window.location.reload(); }
  return <main className="app-frame">
    <aside className="sidebar">
      <Link className="brand sidebar-brand" to="/"><span className="brand-mark">r</span><span>recallio</span></Link>
      <div className="side-label">YOUR SPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <Link className={`nav-link ${title === "Home" ? "selected" : ""}`} to="/"><House className="nav-icon" size={17} />Home</Link>
        <Link className={`nav-link ${title === "Decks" ? "selected" : ""}`} to="/decks"><BookOpen size={17} />Decks</Link>
        <Link className={`nav-link ${title === "Browse" || title === "Add cards" ? "selected" : ""}`} to="/browse"><Sparkles size={16} />Card browser</Link>
        <Link className={`nav-link ${title === "Statistics" ? "selected" : ""}`} to="/statistics"><Sparkles size={16} />Statistics</Link>
        <Link className={`nav-link ${title === "Assessments" || title === "Assessment" ? "selected" : ""}`} to="/assessments"><ClipboardCheck size={16} />Assessments</Link>
      </nav>
      <div className="sidebar-spacer" />
      <div className="help-link"><CircleHelp size={17} />Help & guidance</div>
      <div className="sidebar-footer"><span className="avatar">{user.name.charAt(0).toUpperCase()}</span><span className="user-meta"><strong>{user.name}</strong><small>{user.email}</small></span><button className="icon-button" aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}><ChevronDown size={16} /></button>{menuOpen && <div className="account-menu"><Link to="/profile" onClick={() => setMenuOpen(false)}>Profile</Link><button onClick={logout}>Sign out</button></div>}</div>
    </aside>
    <section className="workspace"><header className="topbar"><div className="breadcrumb"><Link to="/">Your space</Link><span>/</span>{title}</div><div className="top-actions"><SyncStatus userId={user.id} /><Link className="profile-top-action" to="/profile" aria-label="Open profile"><span className="avatar avatar-small">{user.name.charAt(0).toUpperCase()}</span><UserRound size={15} /><span>Profile</span></Link></div></header><div className="page-content">{children}</div></section>
    <nav className="mobile-nav" aria-label="Main navigation"><Link to="/" className={title === "Home" ? "mobile-selected" : ""}><House size={18} />Home</Link><Link to="/decks" className={title === "Decks" ? "mobile-selected" : ""}><BookOpen size={18} />Decks</Link><Link to="/assessments" className={title === "Assessments" || title === "Assessment" ? "mobile-selected" : ""}><ClipboardCheck size={18} />Tests</Link><Link to="/statistics" className={title === "Statistics" ? "mobile-selected" : ""}><Sparkles size={18} />Stats</Link></nav>
  </main>;
}
