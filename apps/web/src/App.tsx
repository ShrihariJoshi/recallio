import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { PublicUser } from "@recallio/contracts";
import { authApi } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { DecksPage } from "./pages/DecksPage";
import { CardEditorPage } from "./pages/CardEditorPage";
import { BrowsePage } from "./pages/BrowsePage";
import { ImportPage } from "./pages/ImportPage";
import { StudyPage } from "./pages/StudyPage";
import { StatisticsPage } from "./pages/StatisticsPage";
import { AssessmentsPage } from "./pages/AssessmentsPage";
import { ProfilePage } from "./pages/ProfilePage";

export function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi.me().then(({ user: current }) => setUser(current)).catch((error: unknown) => {
      if (!navigator.onLine || error instanceof TypeError) {
        try {
          const cached = localStorage.getItem("recallio:offline-user");
          const user = cached ? JSON.parse(cached) as PublicUser : null;
          if (user?.id && user.name && user.email) { setUser(user); return; }
        } catch { /* Ignore malformed local account data. */ }
      }
      localStorage.removeItem("recallio:offline-user");
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (user) localStorage.setItem("recallio:offline-user", JSON.stringify(user)); }, [user]);

  if (loading) return <main className="boot-screen"><span className="brand-mark">r</span><span className="boot-line" /></main>;

  return <Routes>
    <Route path="/login" element={user ? <Navigate to="/" replace /> : <AuthPage onAuthenticated={setUser} />} />
    <Route path="/" element={user ? <HomePage user={user} onLogout={() => { localStorage.removeItem("recallio:offline-user"); setUser(null); }} /> : <Navigate to="/login" replace />} />
    <Route path="/profile" element={user ? <ProfilePage user={user} onUserUpdated={setUser} onLogout={() => { localStorage.removeItem("recallio:offline-user"); setUser(null); }} /> : <Navigate to="/login" replace />} />
    <Route path="/decks" element={user ? <DecksPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/add" element={user ? <CardEditorPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/browse" element={user ? <BrowsePage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/import" element={user ? <ImportPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/study" element={user ? <StudyPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/statistics" element={user ? <StatisticsPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/assessments" element={user ? <AssessmentsPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="/assessment/:attemptId" element={user ? <AssessmentsPage user={user} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
