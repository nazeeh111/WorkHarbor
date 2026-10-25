/**
 * Attachment-chip helpers for the task-chat redesign (PAP-351): map a filename
 * to a kind icon + label for the shadcn base/attachment chips, and extract the
 * non-image file references the composer writes into message bodies
 * ("[name](/api/attachments/<id>/content)") so posted bubbles can render them
 * as the same chips instead of bare links.
 */
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IssueAttachment } from "@paperclipai/shared";

export interface FileKind {
  icon: LucideIcon;
  /** Short kind label for the chip description, e.g. "PDF", "ZIP". */
  label: string;
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
  "ico",
  "heic",
]);

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: { icon: FileText, label: "PDF" },
  doc: { icon: FileText, label: "Doc" },
  docx: { icon: FileText, label: "Doc" },
  txt: { icon: FileText, label: "Text" },
  md: { icon: FileText, label: "Markdown" },
  rtf: { icon: FileText, label: "Text" },
  csv: { icon: FileSpreadsheet, label: "CSV" },
  tsv: { icon: FileSpreadsheet, label: "TSV" },
  xls: { icon: FileSpreadsheet, label: "Sheet" },
  xlsx: { icon: FileSpreadsheet, label: "Sheet" },
  zip: { icon: FileArchive, label: "ZIP" },
  gz: { icon: FileArchive, label: "Archive" },
  tar: { icon: FileArchive, label: "Archive" },
  tgz: { icon: FileArchive, label: "Archive" },
  rar: { icon: FileArchive, label: "Archive" },
  "7z": { icon: FileArchive, label: "Archive" },
  mp3: { icon: FileAudio, label: "Audio" },
  wav: { icon: FileAudio, label: "Audio" },
  m4a: { icon: FileAudio, label: "Audio" },
  ogg: { icon: FileAudio, label: "Audio" },
  mp4: { icon: FileVideo, label: "Video" },
  mov: { icon: FileVideo, label: "Video" },
  webm: { icon: FileVideo, label: "Video" },
  json: { icon: FileCode, label: "JSON" },
  yaml: { icon: FileCode, label: "YAML" },
  yml: { icon: FileCode, label: "YAML" },
  xml: { icon: FileCode, label: "XML" },
  html: { icon: FileCode, label: "HTML" },
  css: { icon: FileCode, label: "CSS" },
  js: { icon: FileCode, label: "Code" },
  jsx: { icon: FileCode, label: "Code" },
  ts: { icon: FileCode, label: "Code" },
  tsx: { icon: FileCode, label: "Code" },
  py: { icon: FileCode, label: "Code" },
  rb: { icon: FileCode, label: "Code" },
  go: { icon: FileCode, label: "Code" },
  rs: { icon: FileCode, label: "Code" },
  sh: { icon: FileCode, label: "Code" },
  sql: { icon: FileCode, label: "SQL" },
  log: { icon: FileText, label: "Log" },
  patch: { icon: FileCode, label: "Patch" },
  diff: { icon: FileCode, label: "Patch" },
};

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
}

export function isImageFilename(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

type AttachmentRecord = Pick<
  IssueAttachment,
  | "id"
  | "contentPath"
  | "openPath"
  | "downloadPath"
  | "contentType"
  | "byteSize"
  | "originalFilename"
>;

function normalizedContentType(contentType: string | undefined): string {
  return (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

/** MIME type is authoritative; filenames remain a fallback for legacy refs. */
export function isImageAttachment(ref: AttachmentRef): boolean {
  const contentType = normalizedContentType(ref.contentType);
  if (contentType.startsWith("image/")) return true;
  if (contentType && contentType !== "application/octet-stream") return false;
  return isImageFilename(ref.name) || isImageFilename(ref.url.split("?")[0]);
}

/** Kind icon + short label for a filename; unknown extensions get File/"File". */
export function fileKindForName(name: string): FileKind {
  return KIND_BY_EXTENSION[extensionOf(name)] ?? { icon: FileIcon, label: "File" };
}

export function fileKindForAttachment(ref: AttachmentRef): FileKind {
  const byName = fileKindForName(ref.name);
  if (byName.label !== "File") return byName;

  const contentType = normalizedContentType(ref.contentType);
  if (contentType === "application/pdf") return { icon: FileText, label: "PDF" };
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return { icon: FileCode, label: "JSON" };
  }
  if (contentType === "text/csv" || contentType === "application/csv") {
    return { icon: FileSpreadsheet, label: "CSV" };
  }
  if (contentType.startsWith("text/")) return { icon: FileText, label: "Text" };
  if (contentType.startsWith("audio/")) return { icon: FileAudio, label: "Audio" };
  if (contentType.startsWith("video/")) return { icon: FileVideo, label: "Video" };
  if (contentType.includes("zip") || contentType.includes("archive")) {
    return { icon: FileArchive, label: "Archive" };
  }
  return byName;
}

/** "2.4 MB"-style size for chip descriptions (same tiers as IssueChatThread). */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachmentRef {
  name: string;
  url: string;
  id?: string;
  contentType?: string;
  byteSize?: number;
  openPath?: string;
  downloadPath?: string;
}

function attachmentIdFromUrl(url: string): string | null {
  return /\/api\/(?:attachments|assets)\/([^/?]+)\/content/.exec(url)?.[1] ?? null;
}

export function hydrateAttachmentRefs(
  refs: AttachmentRef[],
  attachments: AttachmentRecord[],
): AttachmentRef[] {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const byPath = new Map(
    attachments.flatMap((attachment) => [
      [attachment.contentPath, attachment] as const,
      ...(attachment.openPath ? [[attachment.openPath, attachment] as const] : []),
    ]),
  );

  return refs.map((ref) => {
    const cleanUrl = ref.url.split("?")[0];
    const record =
      byPath.get(cleanUrl) ??
      byId.get(attachmentIdFromUrl(ref.url) ?? "");
    if (!record) return ref;
    return {
      ...ref,
      id: record.id,
      name: record.originalFilename?.trim() || ref.name,
      contentType: record.contentType,
      byteSize: record.byteSize,
      openPath: record.openPath,
      downloadPath: record.downloadPath,
    };
  });
}

/**
 * Markdown links (not `![]` embeds) pointing at attachment/asset content. The
 * label admits backslash-escaped characters — the composer escapes `[`/`]` in
 * filenames when inserting references.
 */
const ATTACHMENT_LINK_RE =
  /(?<!!)\[((?:\\.|[^\]\\])+)\]\((\/api\/(?:attachments|assets)\/[^()\s]+\/content(?:\?[^()\s]*)?)\)/g;

/** Markdown image embeds (`![name](url)`), same escaped-label grammar. */
const IMAGE_EMBED_RE = /!\[((?:\\.|[^\]\\])*)\]\(([^()\s]+)\)/g;

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number; line?: number }; end: { offset?: number; line?: number } };
};

/** Read code and paragraph ranges through MarkdownBody's synchronous remark/GFM parser. */
function attachmentMarkdownContext(body: string) {
  const mask = new Uint8Array(body.length);
  const paragraphs: Array<[number, number]> = [];
  Markdown({
    children: body,
    remarkPlugins: [remarkGfm, () => (tree: MarkdownNode) => {
      const visit = (node: MarkdownNode) => {
        if (node.type === "paragraph") {
          const start = node.position?.start.line;
          const end = node.position?.end.line;
          if (start !== undefined && end !== undefined) paragraphs.push([start - 1, end - 1]);
        }
        if (node.type === "code" || node.type === "inlineCode") {
          const start = node.position?.start.offset;
          const end = node.position?.end.offset;
          if (start !== undefined && end !== undefined) mask.fill(1, start, end);
        } else node.children?.forEach(visit);
      };
      visit(tree);
      // We need source positions only, not a second rendered element tree.
      tree.children = [];
    }],
  });
  return { mask, paragraphs };
}

function visibleMatches(line: string, pattern: RegExp, mask: Uint8Array, offset: number) {
  return Array.from(line.matchAll(pattern)).filter((match) => {
    if (mask[offset + match.index]) return false;
    let slashes = 0;
    for (let i = match.index - 1; i >= 0 && line[i] === "\\"; i -= 1) slashes += 1;
    return slashes % 2 === 0;
  });
}

/** Remove only promoted lines and their adjacent separator blanks, never trim code. */
function removePromotedLines(lines: string[], removed: boolean[]): string {
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!removed[i]) { kept.push(lines[i]); continue; }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    while (i + 1 < lines.length && (!lines[i + 1].trim() || removed[i + 1])) i += 1;
    if (kept.length && i + 1 < lines.length) kept.push("");
  }
  return kept.join("\n");
}

function analyzeAttachmentRefs(body: string) {
  const { mask, paragraphs } = body.includes("](")
    ? attachmentMarkdownContext(body)
    : { mask: new Uint8Array(0), paragraphs: [] };
  const refs: AttachmentRef[] = [];
  const imageRefs: AttachmentRef[] = [];
  const seen = new Set<string>();
  const seenImages = new Set<string>();
  const lines = body.split("\n");
  const fileLines: boolean[] = [];
  const imageLines: boolean[] = [];
  const imageMatches: RegExpMatchArray[][] = [];
  for (const [, name, url] of visibleMatches(body, ATTACHMENT_LINK_RE, mask, 0)) {
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({ name: name.replace(/\\([[\]])/g, "$1"), url });
  }
  let offset = 0;
  for (const line of lines) {
    const files = visibleMatches(line, ATTACHMENT_LINK_RE, mask, offset);
    const images = visibleMatches(line, IMAGE_EMBED_RE, mask, offset);
    offset += line.length + 1;
    const without = (matches: RegExpMatchArray[]) => matches.reduceRight((text, match) =>
      text.slice(0, match.index!) + text.slice(match.index! + match[0].length), line);
    fileLines.push(files.length > 0 && !without(files).trim());
    const standaloneImages = images.length > 0 && !without(images).trim();
    imageLines.push(standaloneImages);
    imageMatches.push(images);
  }
  // A leading link can make following indented text a lazy paragraph
  // continuation. Keep that context rather than turning the prose into code.
  for (const [start, end] of paragraphs) {
    let firstKept = start;
    while (firstKept <= end && (fileLines[firstKept] || imageLines[firstKept])) firstKept += 1;
    if (firstKept > start && firstKept <= end && /^(?: {4}| {0,3}\t)/.test(lines[firstKept])) {
      for (let i = start; i < firstKept; i += 1) fileLines[i] = imageLines[i] = false;
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (imageLines[i]) {
      for (const [, name, url] of imageMatches[i]) {
        if (seenImages.has(url)) continue;
        seenImages.add(url);
        imageRefs.push({ name: name.replace(/\\([[\]])/g, "$1"), url });
      }
    }
  }
  return { refs, imageRefs, lines, fileLines, imageLines };
}

/** Images on standalone non-code lines, in document order, deduped by URL. */
export function extractImageRefs(body: string): AttachmentRef[] {
  return analyzeAttachmentRefs(body).imageRefs;
}

/** Remove standalone image-embed lines after promoting them to the media strip. */
export function stripStandaloneImageEmbeds(body: string): string {
  const { lines, imageLines } = analyzeAttachmentRefs(body);
  return removePromotedLines(lines, imageLines);
}

export interface ExtractedAttachmentRefs {
  refs: AttachmentRef[];
  /** Body with lines that were nothing but extracted links removed. */
  text: string;
}

/** Pull attachment links out of prose, retaining literal code and other bytes. */
export function extractAttachmentRefs(body: string): ExtractedAttachmentRefs {
  const { refs, lines, fileLines } = analyzeAttachmentRefs(body);
  return { refs, text: removePromotedLines(lines, fileLines) };
}

/** The bubble classifies the original body once, before removing any lines. */
export function extractMessageAttachmentRefs(body: string) {
  const { refs, imageRefs, lines, fileLines, imageLines } = analyzeAttachmentRefs(body);
  return {
    refs,
    imageRefs,
    text: removePromotedLines(lines, fileLines.map((file, index) => file || imageLines[index])),
  };
}
