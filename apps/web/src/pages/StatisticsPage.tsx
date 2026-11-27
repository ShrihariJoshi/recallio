import { useQuery } from "@tanstack/react-query";
import { Activity, BookOpen, CalendarDays, Layers3 } from "lucide-react";
import type { PublicUser } from "@recallio/contracts";
import { statisticsApi } from "../api";
import { WorkspaceLayout } from "../components/WorkspaceLayout";
import { StudyActivityChart } from "../components/StudyActivityChart";

const ratingDetails = [
  { key: "again", label: "Again", hint: "Couldn’t recall", tone: "again" },
  { key: "hard", label: "Hard", hint: "With effort", tone: "hard" },
  { key: "good", label: "Good", hint: "Remembered", tone: "good" },
  { key: "easy", label: "Easy", hint: "Came right away", tone: "easy" },
] as const;

export function StatisticsPage({ user }: { user: PublicUser }) {
  const stats = useQuery({ queryKey: ["dashboard-statistics", 30], queryFn: () => statisticsApi.dashboard(30), staleTime: 60_000 });
  const data = stats.data;
  const ratingsTotal = data ? Object.values(data.ratings).reduce((sum, count) => sum + count, 0) : 0;
  return <WorkspaceLayout user={user} title="Statistics">
    <div className="page-heading-row"><div><div className="date-label">YOUR PROGRESS</div><h1>Statistics</h1><p>A clear view of your recent study activity.</p></div></div>
    {stats.isLoading ? <div className="statistics-loading"><span className="study-loading" />Loading your learning history…</div>
      : stats.error ? <div className="statistics-error" role="alert">Couldn’t load your statistics. Refresh to try again.</div>
      : data && <>
        <section className="statistics-overview" aria-label="Study overview">
          <article className="statistics-tile"><span className="statistics-tile-icon due-icon"><CalendarDays size={16} /></span><div><strong>{data.overview.dueNow}</strong><span>Due now</span></div></article>
          <article className="statistics-tile"><span className="statistics-tile-icon new-icon"><Layers3 size={16} /></span><div><strong>{data.overview.newCards}</strong><span>New cards</span></div></article>
          <article className="statistics-tile"><span className="statistics-tile-icon reviews-icon"><Activity size={16} /></span><div><strong>{data.rangeReviews}</strong><span>Reviews · 30 days</span></div></article>
          <article className="statistics-tile"><span className="statistics-tile-icon total-icon"><BookOpen size={16} /></span><div><strong>{data.studyDays}</strong><span>Study days · 30 days</span></div></article>
        </section>
        <StudyActivityChart activity={data.activity} rangeReviews={data.rangeReviews} title="Last 30 days" />
        <section className="rating-panel">
          <div className="activity-panel-head"><div><strong>Recall ratings</strong><small>Your self-ratings over the last 30 days</small></div><span><b>{ratingsTotal}</b> rated reviews</span></div>
          {ratingsTotal ? <div className="rating-breakdown">{ratingDetails.map((rating) => {
            const count = data.ratings[rating.key];
            const percentage = Math.round((count / ratingsTotal) * 100);
            return <div className="rating-breakdown-row" key={rating.key}><div className="rating-breakdown-label"><strong>{rating.label}</strong><span>{rating.hint}</span></div><div className="rating-breakdown-track"><span className={`rating-fill rating-fill-${rating.tone}`} style={{ width: `${percentage}%` }} /></div><span className="rating-breakdown-count">{count}<small>{percentage}%</small></span></div>;
          })}</div> : <div className="rating-empty"><span>Your first review will appear here.</span></div>}
        </section>
      </>}
  </WorkspaceLayout>;
}
