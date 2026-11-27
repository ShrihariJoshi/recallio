import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { cacheMediaImages, getCachedMediaImage } from "../offline/database";
import { mediaAssetUrl } from "../api";

const allowedTags = [
  "div", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "span", "sub", "sup",
  "code", "pre", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "font", "img",
];
const allowedStyles = new Set(["color", "background-color", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "vertical-align"]);

function safeColor(value: string): boolean {
  return /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%\s,/-]+\)|[a-z]{1,24})$/i.test(value.trim());
}

function safeStyleValue(name: string, value: string): boolean {
  const normalized = value.trim();
  switch (name) {
    case "color":
    case "background-color": return safeColor(normalized);
    case "font-size": return /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i.test(normalized);
    case "font-weight": return /^(?:normal|bold|bolder|lighter|[1-9]00)$/i.test(normalized);
    case "font-style": return /^(?:normal|italic|oblique)$/i.test(normalized);
    case "text-decoration": return /^(?:none|underline|line-through)$/i.test(normalized);
    case "text-align": return /^(?:left|right|center|justify|start|end)$/i.test(normalized);
    case "vertical-align": return /^(?:baseline|sub|super|top|bottom|middle)$/i.test(normalized);
    default: return false;
  }
}

function sanitizeForDisplay(dirty: string): string {
  const clean = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ["style", "color", "alt", "src", "width", "height", "class"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;

  for (const element of template.content.querySelectorAll<HTMLElement>("[style]")) {
    const parsed = document.createElement("span");
    parsed.style.cssText = element.getAttribute("style") ?? "";
    const safe = document.createElement("span").style;
    for (let index = 0; index < parsed.style.length; index += 1) {
      const name = parsed.style.item(index).toLowerCase();
      const value = parsed.style.getPropertyValue(name);
      if (allowedStyles.has(name) && safeStyleValue(name, value)) safe.setProperty(name, value);
    }
    if (safe.length) element.setAttribute("style", safe.cssText);
    else element.removeAttribute("style");
  }

  for (const element of template.content.querySelectorAll<HTMLElement>("[color]")) {
    if (!safeColor(element.getAttribute("color") ?? "")) element.removeAttribute("color");
  }
  const safeClasses = new Set(["recallio-occlusion", "recallio-occlusion-mask", "recallio-occlusion-image"]);
  for (const element of template.content.querySelectorAll<HTMLElement>("[class]")) {
    const classes = [...element.classList].filter((name) => safeClasses.has(name));
    if (classes.length) element.className = classes.join(" ");
    else element.removeAttribute("class");
  }
  for (const image of template.content.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const alt = image.getAttribute("alt")?.trim();
    if (!/^\/api\/v1\/media\/[a-f\d]{24}$/i.test(src)) {
      image.replaceWith(document.createTextNode(alt ? `[Image: ${alt}]` : "[Image unavailable]"));
      continue;
    }
    image.dataset.mediaPath = src;
    image.removeAttribute("src");
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  }
  return template.innerHTML;
}

export function RichContent({ html, className, userId }: { html: string; className?: string; userId?: string }) {
  const safeHtml = useMemo(() => sanitizeForDisplay(html), [html]);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    const images = Array.from(container.current?.querySelectorAll<HTMLImageElement>("img[data-media-path]") ?? []);
    for (const image of images) {
      const mediaPath = image.dataset.mediaPath ?? "";
      const mediaId = mediaPath.match(/^\/api\/v1\/media\/([a-f\d]{24})$/i)?.[1];
      if (!mediaId) continue;
      void (async () => {
        try {
          const cached = userId ? await getCachedMediaImage(userId, mediaId) : undefined;
          let blob = cached?.blob;
          let mimeType = cached?.mimeType ?? "";
          if (!blob) {
            const response = await fetch(mediaAssetUrl(mediaId), { credentials: "include" });
            if (!response.ok) throw new Error("Image request failed.");
            mimeType = response.headers.get("content-type") ?? "";
            if (!mimeType.startsWith("image/")) throw new Error("Response is not an image.");
            blob = await response.blob();
            if (userId) await cacheMediaImages(userId, [{ mediaId, blob, mimeType }]);
          }
          const objectUrl = URL.createObjectURL(blob);
          if (!active) { URL.revokeObjectURL(objectUrl); return; }
          objectUrls.push(objectUrl);
          image.src = objectUrl;
        } catch {
          if (active) { image.alt ||= "Image unavailable"; image.classList.add("rich-content-image-error"); }
        }
      })();
    }
    return () => { active = false; objectUrls.forEach(URL.revokeObjectURL); };
  }, [safeHtml, userId]);
  return <div ref={container} className={className ? `rich-content ${className}` : "rich-content"} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
