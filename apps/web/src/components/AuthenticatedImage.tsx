import { useEffect, useState } from "react";
import { mediaAssetUrl } from "../api";
import { getCachedAssessmentImage } from "../offline/database";

export function AuthenticatedImage({ mediaId, userId, alt, className }: { mediaId: string; userId: string; alt: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl = "";
    setObjectUrl("");
    setFailed(false);
    (async () => {
      try {
        const cached = await getCachedAssessmentImage(userId, mediaId);
        let blob = cached?.blob;
        if (!blob) {
          const response = await fetch(mediaAssetUrl(mediaId), { credentials: "include" });
          if (!response.ok) throw new Error("Image request failed.");
          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.startsWith("image/")) throw new Error("Response is not an image.");
          blob = await response.blob();
        }
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      } catch { if (active) setFailed(true); }
    })();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [mediaId, userId]);

  if (failed) return <span className={`authenticated-image-error ${className ?? ""}`} role="img" aria-label={`${alt} unavailable`}>Image unavailable</span>;
  if (!objectUrl) return <span className={`authenticated-image-loading ${className ?? ""}`} role="status">Loading image…</span>;
  return <img src={objectUrl} alt={alt} className={className} />;
}
