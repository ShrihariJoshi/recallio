import type { StatisticsSummary } from "../api";

export function StudyActivityChart({ activity, rangeReviews, title = "Study activity", compact = false }: {
  activity: StatisticsSummary["activity"];
  rangeReviews: number;
  title?: string;
  compact?: boolean;
}) {
  const maximum = Math.max(1, ...activity.map((day) => day.reviews));
  const weekly = activity.length <= 7;
  return <section className={`activity-panel ${compact ? "activity-compact" : ""}`} aria-label={title}>
    <div className="activity-panel-head"><div><strong>{title}</strong><small>{weekly ? "One bar per day" : "Daily reviews"}</small></div><span><b>{rangeReviews}</b> reviews</span></div>
    <div className={`activity-chart ${weekly ? "activity-week" : "activity-month"}`} role="list" aria-label={`${rangeReviews} reviews across ${activity.length} days`}>
      {activity.map((day, index) => {
        const date = new Date(`${day.date}T12:00:00`);
        const label = weekly ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date) : date.getDate();
        const height = day.reviews ? Math.max(8, Math.round((day.reviews / maximum) * 100)) : 3;
        const showMonthLabel = weekly || index === 0 || index === activity.length - 1 || date.getDate() % 5 === 0;
        const spokenDate = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" }).format(date);
        return <div className="activity-day" key={day.date} role="listitem" aria-label={`${spokenDate}: ${day.reviews} ${day.reviews === 1 ? "review" : "reviews"}`}>
          <div className="activity-bar-track"><span className={day.reviews ? "has-reviews" : ""} style={{ height: `${height}%` }} title={`${day.reviews} ${day.reviews === 1 ? "review" : "reviews"}`} /></div>
          <span className={`activity-day-label ${showMonthLabel ? "" : "visually-quiet"}`}>{label}</span>
        </div>;
      })}
    </div>
  </section>;
}
