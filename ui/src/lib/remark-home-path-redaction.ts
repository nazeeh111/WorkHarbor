import { redactHomePathUserSegments } from "@paperclipai/adapter-utils";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  children?: MarkdownNode[];
};

/** Mask parsed content, after Markdown delimiters have become structure. */
export function remarkHomePathRedaction() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (["text", "inlineCode", "code", "html"].includes(node.type) && typeof node.value === "string") {
        node.value = redactHomePathUserSegments(node.value);
      }
      if (["link", "image", "definition"].includes(node.type)) {
        if (typeof node.url === "string") node.url = redactHomePathUserSegments(node.url);
        if (typeof node.title === "string") node.title = redactHomePathUserSegments(node.title);
      }
      if (["image", "imageReference"].includes(node.type) && typeof node.alt === "string") {
        node.alt = redactHomePathUserSegments(node.alt);
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
