import { describe, expect, it } from "vitest";
import {
  extractAttachmentRefs,
  extractMessageAttachmentRefs,
  extractImageRefs,
  fileKindForAttachment,
  fileKindForName,
  formatFileSize,
  hydrateAttachmentRefs,
  isImageAttachment,
  isImageFilename,
  stripStandaloneImageEmbeds,
} from "./task-chat-attachments";

describe("fileKindForName", () => {
  it("maps known extensions to kind labels", () => {
    expect(fileKindForName("report.pdf").label).toBe("PDF");
    expect(fileKindForName("data.csv").label).toBe("CSV");
    expect(fileKindForName("bundle.zip").label).toBe("ZIP");
    expect(fileKindForName("script.ts").label).toBe("Code");
  });

  it("falls back to File for unknown or missing extensions", () => {
    expect(fileKindForName("mystery.xyz").label).toBe("File");
    expect(fileKindForName("README").label).toBe("File");
  });
});

describe("isImageFilename", () => {
  it("detects image extensions case-insensitively", () => {
    expect(isImageFilename("shot.PNG")).toBe(true);
    expect(isImageFilename("photo.jpeg")).toBe(true);
    expect(isImageFilename("notes.txt")).toBe(false);
  });
});

describe("attachment record metadata", () => {
  it("detects an extensionless image from its content type", () => {
    expect(
      isImageAttachment({
        name: "desktop Default",
        url: "/api/attachments/screenshot/content",
        contentType: "image/png",
      }),
    ).toBe(true);
  });

  it("falls back to the extension for generic attachment content", () => {
    expect(
      isImageAttachment({
        name: "shot.png",
        url: "/api/attachments/screenshot/content",
        contentType: "application/octet-stream",
      }),
    ).toBe(true);
  });

  it("uses content type for an extensionless file kind", () => {
    expect(
      fileKindForAttachment({
        name: "report",
        url: "/api/attachments/report/content",
        contentType: "application/pdf",
      }).label,
    ).toBe("PDF");
  });

  it("hydrates refs with the stored type, size, and paths", () => {
    const [ref] = hydrateAttachmentRefs(
      [{ name: "desktop Default", url: "/api/attachments/a1/content" }],
      [
        {
          id: "a1",
          contentPath: "/api/attachments/a1/content",
          openPath: "/api/attachments/a1/content",
          downloadPath: "/api/attachments/a1/content?download=1",
          contentType: "image/png",
          byteSize: 2048,
          originalFilename: "desktop Default",
        },
      ],
    );
    expect(ref).toMatchObject({
      id: "a1",
      contentType: "image/png",
      byteSize: 2048,
    });
  });
});

describe("formatFileSize", () => {
  it("formats byte tiers", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("returns empty for missing or non-positive sizes", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(0)).toBe("");
  });
});

describe("extractAttachmentRefs", () => {
  it("extracts attachment links and strips link-only lines", () => {
    const body = "Here are the notes.\n\n[notes.txt](/api/attachments/abc/content) ";
    const { refs, text } = extractAttachmentRefs(body);
    expect(refs).toEqual([{ name: "notes.txt", url: "/api/attachments/abc/content" }]);
    expect(text).toBe("Here are the notes.");
  });

  it("keeps links woven into prose while still chipping them", () => {
    const body = "See [report.pdf](/api/attachments/r1/content) for details.";
    const { refs, text } = extractAttachmentRefs(body);
    expect(refs).toEqual([{ name: "report.pdf", url: "/api/attachments/r1/content" }]);
    expect(text).toBe(body);
  });

  it("ignores image embeds but returns image-named attachment links for classification", () => {
    const body =
      "![shot.png](/api/attachments/img/content)\n[photo.jpg](/api/attachments/p/content)\n[notes.txt](/api/attachments/n/content)";
    const { refs } = extractAttachmentRefs(body);
    expect(refs).toEqual([
      { name: "photo.jpg", url: "/api/attachments/p/content" },
      { name: "notes.txt", url: "/api/attachments/n/content" },
    ]);
  });

  it("ignores non-attachment links entirely", () => {
    const body = "[docs](https://example.com/content) and [PAP-1](/issues/PAP-1)";
    const { refs, text } = extractAttachmentRefs(body);
    expect(refs).toEqual([]);
    expect(text).toBe(body);
  });

  it("dedupes repeated references to the same attachment", () => {
    const body =
      "[notes.txt](/api/attachments/n/content)\n[notes.txt](/api/attachments/n/content)";
    const { refs, text } = extractAttachmentRefs(body);
    expect(refs).toHaveLength(1);
    expect(text).toBe("");
  });

  it("unescapes bracket-escaped labels and accepts asset content paths", () => {
    const body = String.raw`[weird \[name\].txt](/api/assets/a1/content?download=1)`;
    const { refs } = extractAttachmentRefs(body);
    expect(refs).toEqual([
      { name: "weird [name].txt", url: "/api/assets/a1/content?download=1" },
    ]);
  });
});

describe("extractImageRefs", () => {
  it("collects image embeds in order, skipping plain links", () => {
    const body =
      "![a.png](/api/attachments/a/content)\nSee [notes.txt](/api/attachments/n/content)\n![b.jpg](https://example.com/b.jpg)";
    expect(extractImageRefs(body)).toEqual([
      { name: "a.png", url: "/api/attachments/a/content" },
      { name: "b.jpg", url: "https://example.com/b.jpg" },
    ]);
  });

  it("dedupes repeated embeds and tolerates empty alt text", () => {
    const body = "![](/api/attachments/a/content)\n![again](/api/attachments/a/content)";
    expect(extractImageRefs(body)).toEqual([{ name: "", url: "/api/attachments/a/content" }]);
  });

  it("unescapes bracket-escaped alt text", () => {
    const body = String.raw`![shot \[1\].png](/api/attachments/s/content)`;
    expect(extractImageRefs(body)).toEqual([
      { name: "shot [1].png", url: "/api/attachments/s/content" },
    ]);
  });

  it("returns nothing for bodies without images", () => {
    expect(extractImageRefs("just text and a [link](/api/attachments/x/content)")).toEqual([]);
  });

  it("promotes standalone embeds but leaves prose-woven embeds inline", () => {
    const body = [
      "Standalone embed on its own line:",
      "",
      "![shot one](/api/attachments/a/content)",
      "",
      "And here is an image ![inline two](/api/attachments/b/content) woven into this sentence.",
    ].join("\n");

    expect(extractImageRefs(body)).toEqual([
      { name: "shot one", url: "/api/attachments/a/content" },
    ]);
    expect(stripStandaloneImageEmbeds(body)).toBe(
      [
        "Standalone embed on its own line:",
        "",
        "And here is an image ![inline two](/api/attachments/b/content) woven into this sentence.",
      ].join("\n"),
    );
  });
});

describe("stripStandaloneImageEmbeds", () => {
  it("removes tail embeds promoted to thumbnails but keeps prose", () => {
    expect(
      stripStandaloneImageEmbeds("Done.\n\n![desktop Default](/api/attachments/a/content)"),
    ).toBe("Done.");
  });
});

describe("literal code and attachment promotion", () => {
  const literalBodies = [
    "```markdown\n![example](/api/attachments/example/content)\n[example.txt](/api/attachments/example/content)\n```",
    "~~~markdown\n![example](/api/attachments/example/content)\n~~~",
    "````markdown\n```\n[example.txt](/api/attachments/example/content)\n````",
    "```markdown\n[example.txt](/api/attachments/example/content)",
    "    [example.txt](/api/attachments/example/content)\n\n    next line",
    "\t![example](/api/attachments/example/content)",
    "`[example.txt](/api/attachments/example/content)`",
    "``literal ` [example.txt](/api/attachments/example/content)``",
    "`first\n![example](/api/attachments/example/content)\nlast`",
    "> ```markdown\n> [example.txt](/api/attachments/example/content)\n> ```",
    "- ```markdown\n  [example.txt](/api/attachments/example/content)\n  ```",
    "```markdown\r\n[example.txt](/api/attachments/example/content)\r\n```",
    "    console.log(\"keep indentation\");",
    "```text\nfirst\n\n\nsecond\n```",
    "\n\n    leading and trailing whitespace\n\n",
  ];

  it.each(literalBodies)("preserves literal code bytes: %s", (body) => {
    const files = extractAttachmentRefs(body);
    expect(files).toEqual({ refs: [], text: body });
    expect(extractImageRefs(files.text)).toEqual([]);
    expect(stripStandaloneImageEmbeds(files.text)).toBe(body);
  });

  it("promotes real attachments outside code while preserving the code content", () => {
    const code = "```markdown\n[example.txt](/api/attachments/example/content)\n\n\n![sample](/api/attachments/sample/content)\n```";
    const body = `${code}\n\n[notes.txt](/api/attachments/notes/content)\n\n![proof](/api/attachments/proof/content)`;
    const files = extractAttachmentRefs(body);
    expect(files.refs).toEqual([{ name: "notes.txt", url: "/api/attachments/notes/content" }]);
    expect(extractImageRefs(files.text)).toEqual([{ name: "proof", url: "/api/attachments/proof/content" }]);
    expect(stripStandaloneImageEmbeds(files.text)).toBe(code);
  });

  it("keeps multiline prose-link extraction without rewriting its body", () => {
    const body = "See [notes\nfile](/api/attachments/notes/content) here.";
    expect(extractAttachmentRefs(body)).toEqual({
      refs: [{ name: "notes\nfile", url: "/api/attachments/notes/content" }],
      text: body,
    });
  });

  it("leaves escaped links literal and recognizes an unmatched backtick as prose", () => {
    const escaped = String.raw`\[example.txt](/api/attachments/example/content)`;
    expect(extractAttachmentRefs(escaped)).toEqual({ refs: [], text: escaped });
    expect(extractAttachmentRefs("` See [notes.txt](/api/attachments/notes/content)").refs)
      .toEqual([{ name: "notes.txt", url: "/api/attachments/notes/content" }]);
  });
});

describe("attachment promotion at Markdown block boundaries", () => {
  const cases = [
  {
    "name": "list-exit-file",
    "body": "- ```\n  literal\n\n[real.txt](/api/attachments/real/content)",
    "expected": {
      "refs": [
        {
          "name": "real.txt",
          "url": "/api/attachments/real/content"
        }
      ],
      "imageRefs": [],
      "text": "- ```\n  literal"
    }
  },
  {
    "name": "list-exit-root-fence",
    "body": "- ```\n  inner\n\n```\n[example.txt](/api/attachments/example/content)\n```",
    "expected": {
      "refs": [],
      "imageRefs": [],
      "text": "- ```\n  inner\n\n```\n[example.txt](/api/attachments/example/content)\n```"
    }
  },
  {
    "name": "quote-exit-control",
    "body": "> ```\n> literal\n\n[real.txt](/api/attachments/real/content)",
    "expected": {
      "refs": [
        {
          "name": "real.txt",
          "url": "/api/attachments/real/content"
        }
      ],
      "imageRefs": [],
      "text": "> ```\n> literal"
    }
  },
  {
    "name": "normal-mixed-control",
    "body": "```text\n[example.txt](/api/attachments/example/content)\n```\n\n[real.txt](/api/attachments/real/content)",
    "expected": {
      "refs": [
        {
          "name": "real.txt",
          "url": "/api/attachments/real/content"
        }
      ],
      "imageRefs": [],
      "text": "```text\n[example.txt](/api/attachments/example/content)\n```"
    }
  },
  {
    "name": "list-exit-image",
    "body": "- ~~~\n  literal\n\n![real](/api/attachments/real/content)",
    "expected": {
      "refs": [],
      "imageRefs": [
        {
          "name": "real",
          "url": "/api/attachments/real/content"
        }
      ],
      "text": "- ~~~\n  literal"
    }
  },
  {
    "name": "block-inline-boundary",
    "body": "` unclosed\n# Heading\n[real.txt](/api/attachments/real/content)\n`",
    "expected": {
      "refs": [
        {
          "name": "real.txt",
          "url": "/api/attachments/real/content"
        }
      ],
      "imageRefs": [],
      "text": "` unclosed\n# Heading\n\n`"
    }
  },
  {
    "name": "heading-to-indented-code",
    "body": "# Heading\n    [example.txt](/api/attachments/example/content)",
    "expected": {
      "refs": [],
      "imageRefs": [],
      "text": "# Heading\n    [example.txt](/api/attachments/example/content)"
    }
  },
  {
    "name": "blockquote-blank",
    "body": "> ```\n\n> [literal](/api/attachments/literal/content)\n> ```",
    "expected": {
      "refs": [
        {
          "name": "literal",
          "url": "/api/attachments/literal/content"
        }
      ],
      "imageRefs": [],
      "text": "> ```\n\n> [literal](/api/attachments/literal/content)\n> ```"
    }
  }
];

  it.each(cases)("$name", ({ body, expected }) => {
    expect(extractMessageAttachmentRefs(body)).toEqual(expected);
    const files = extractAttachmentRefs(body);
    expect(files.refs).toEqual(expected.refs);
    expect(extractImageRefs(files.text)).toEqual(expected.imageRefs);
    expect(stripStandaloneImageEmbeds(files.text)).toBe(expected.text);
  });
});

describe("leading attachments in a prose paragraph", () => {
  it("keeps the link that anchors an indented prose continuation", () => {
    const body = "[real.txt](/api/attachments/real/content)\n    ordinary prose continuation";
    const expected = { refs: [{ name: "real.txt", url: "/api/attachments/real/content" }], imageRefs: [], text: body };
    expect(extractMessageAttachmentRefs(body)).toEqual(expected);
    expect(extractAttachmentRefs(body)).toEqual({ refs: expected.refs, text: body });
  });

  it("keeps an image inline when it anchors an indented prose continuation", () => {
    const body = "![real](/api/attachments/real/content)\n    ordinary prose continuation";
    expect(extractMessageAttachmentRefs(body)).toEqual({ refs: [], imageRefs: [], text: body });
    expect(extractImageRefs(body)).toEqual([]);
    expect(stripStandaloneImageEmbeds(body)).toBe(body);
  });
});
