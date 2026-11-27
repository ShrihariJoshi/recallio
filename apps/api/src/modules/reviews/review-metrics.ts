import { fsrsMetadata, type FsrsCard } from "@recallio/scheduler";

export function schedulerStateFields(card: FsrsCard) {
  return {
    schedulerPackage: fsrsMetadata.packageVersion,
    schedulerModel: fsrsMetadata.modelVersion,
    desiredRetention: fsrsMetadata.desiredRetention,
    schedulerCard: card,
    dueAt: card.dueAt,
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewAt: card.lastReviewAt,
  };
}

export function reviewEventSchedulerFields(
  beforeCard: FsrsCard,
  afterCard: FsrsCard,
  schedulerReviewLog: unknown,
) {
  return {
    schedulerPackage: fsrsMetadata.packageVersion,
    schedulerModel: fsrsMetadata.modelVersion,
    beforeCard,
    afterCard,
    schedulerReviewLog,
    dueAt: afterCard.dueAt,
    scheduledDays: afterCard.scheduledDays,
  };
}
