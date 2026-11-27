export interface DayRatingMetrics {
  _id: string;
  reviews: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface ActivityDayMetric { date: string; reviews: number }

export function summarizeDashboardActivity(keys: string[], rawActivity: DayRatingMetrics[]) {
  const activityByDate = new Map(rawActivity.map((day) => [day._id, day]));
  const activity: ActivityDayMetric[] = keys.map((date) => ({ date, reviews: activityByDate.get(date)?.reviews ?? 0 }));
  const ratings = rawActivity.reduce((totals, day) => ({
    again: totals.again + day.again,
    hard: totals.hard + day.hard,
    good: totals.good + day.good,
    easy: totals.easy + day.easy,
  }), { again: 0, hard: 0, good: 0, easy: 0 });

  return {
    activity,
    ratings,
    rangeReviews: activity.reduce((sum, day) => sum + day.reviews, 0),
    studyDays: activity.filter((day) => day.reviews > 0).length,
  };
}
