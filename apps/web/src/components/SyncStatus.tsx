import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, Cloud, LoaderCircle, WifiOff } from "lucide-react";
import { localDb } from "../offline/database";
import { syncPendingAssessments, syncPendingReviews } from "../offline/sync";

type Status = "offline" | "syncing" | "synced" | "failed";

export function SyncStatus({ userId }: { userId: string }) {
  const [status, setStatus] = useState<Status>(() => navigator.onLine ? "synced" : "offline");
  const [pending, setPending] = useState(0);
  const refresh = useCallback(async () => {
    const [queued, failed] = await Promise.all([
      localDb.syncQueue.where("userId").equals(userId).count(),
      localDb.syncQueue.where("userId").equals(userId).and((item) => item.status === "failed").count(),
    ]);
    setPending(queued);
    setStatus(!navigator.onLine ? "offline" : failed ? "failed" : queued ? "syncing" : "synced");
  }, [userId]);

  useEffect(() => {
    let mounted = true;
    const refreshIfMounted = () => { if (mounted) void refresh(); };
    const syncAll = async () => { await Promise.all([syncPendingReviews(userId), syncPendingAssessments(userId)]); };
    const onOnline = () => { setStatus("syncing"); void syncAll().finally(refreshIfMounted); };
    const onOffline = () => { setStatus("offline"); };
    const onStart = () => setStatus("syncing");
    const onChange = () => {
      void refresh().then(async () => {
        if (!navigator.onLine) return;
        const [queued, failed, pendingAssessments] = await Promise.all([
          localDb.syncQueue.where("userId").equals(userId).count(),
          localDb.syncQueue.where("userId").equals(userId).and((item) => item.status === "failed").count(),
          localDb.assessmentAttempts.where("userId").equals(userId).and((item) => item.syncStatus === "pending").count(),
        ]);
        if ((queued > failed && failed === 0) || pendingAssessments) await syncAll().finally(refreshIfMounted);
      });
    };
    const onAssessmentChange = () => {
      if (!navigator.onLine) return;
      void localDb.assessmentAttempts.where("userId").equals(userId).and((item) => item.syncStatus === "pending").count().then((count) => { if (count) return syncPendingAssessments(userId); }).finally(refreshIfMounted);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("recallio-sync-change", onChange);
    window.addEventListener("recallio-assessment-sync-change", onAssessmentChange);
    window.addEventListener("recallio-sync-start", onStart);
    window.addEventListener("recallio-sync-end", refreshIfMounted);
    void refresh().then(() => { if (navigator.onLine) void syncAll().finally(refreshIfMounted); });
    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("recallio-sync-change", onChange);
      window.removeEventListener("recallio-assessment-sync-change", onAssessmentChange);
      window.removeEventListener("recallio-sync-start", onStart);
      window.removeEventListener("recallio-sync-end", refreshIfMounted);
    };
  }, [refresh, userId]);

  const labels: Record<Status, string> = { offline: "Offline", syncing: "Syncing", synced: "Synced", failed: "Sync needs attention" };
  const icons = { offline: WifiOff, syncing: LoaderCircle, synced: Check, failed: AlertCircle };
  const Icon = icons[status];
  return <span className={`sync-status sync-${status}`} title={pending ? `${pending} queued review${pending === 1 ? "" : "s"}` : labels[status]} aria-live="polite"><Icon size={13} className={status === "syncing" ? "sync-spin" : ""} />{labels[status]}{pending > 0 && <small>{pending}</small>}{status === "failed" && <button type="button" onClick={() => void syncPendingReviews(userId)} aria-label="Retry syncing reviews"><Cloud size={13} /></button>}</span>;
}
