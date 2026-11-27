import sanitizeHtml from "sanitize-html";

const colorPattern = /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%\s,/-]+\)|[a-z]{1,24})$/i;
const allowedTags = [
  "div", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins",
  "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "span", "sub", "sup",
  "code", "pre", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "img",
];

const options: sanitizeHtml.IOptions = {
  allowedTags,
  allowedAttributes: { "*": ["style"], div: ["class"], img: ["src", "alt", "width", "height", "class"], font: ["color"] },
  allowedStyles: { "*": {
    color: [colorPattern],
    "background-color": [colorPattern],
    "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i],
    "font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
    "font-style": [/^(?:normal|italic|oblique)$/i],
    "text-decoration": [/^(?:none|underline|line-through)$/i],
    "text-align": [/^(?:left|right|center|justify|start|end)$/i],
    "vertical-align": [/^(?:baseline|sub|super|top|bottom|middle)$/i],
  } },
  transformTags: {
    font: (_tagName, attribs) => {
      const color = attribs.color?.trim();
      const safeAttributes: Record<string, string> = {};
      if (color && colorPattern.test(color)) safeAttributes.style = `color:${color}`;
      return { tagName: "span", attribs: safeAttributes };
    },
    img: (_tagName, attribs) => {
      const alt = (attribs.alt ?? "").trim().slice(0, 300);
      const src = attribs.src?.trim() ?? "";
      if (!/^\/api\/v1\/media\/[a-f\d]{24}$/i.test(src)) return { tagName: "span", attribs: {}, text: alt ? `[Image: ${alt}]` : "[Image unavailable]" };
      const className = ["recallio-occlusion-mask", "recallio-occlusion-image"].includes(attribs.class ?? "") ? attribs.class : undefined;
      return { tagName: "img", attribs: { src, ...(alt ? { alt } : {}), ...(attribs.width ? { width: attribs.width } : {}), ...(attribs.height ? { height: attribs.height } : {}), ...(className ? { class: className } : {}) } };
    },
    div: (_tagName, attribs) => {
      const safeAttributes: Record<string, string> = attribs.class === "recallio-occlusion" ? { class: "recallio-occlusion" } : {};
      return { tagName: "div", attribs: safeAttributes };
    },
  },
  disallowedTagsMode: "discard",
  allowedSchemes: [],
  allowProtocolRelative: false,
};

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, options);
}

export function sanitizeNoteFields(fields: { front: string; back: string; extra: string }): { front: string; back: string; extra: string } {
  return {
    front: sanitizeRichText(fields.front),
    back: sanitizeRichText(fields.back),
    extra: sanitizeRichText(fields.extra),
  };
}
