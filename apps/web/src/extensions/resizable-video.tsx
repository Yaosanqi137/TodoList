import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ResizableMediaNodeView } from "@/components/editor/resizable-media-node-view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    video: {
      setVideo: (attributes: {
        src: string;
        title?: string | null;
        widthPercent?: number;
        align?: "left" | "center" | "right";
      }) => ReturnType;
    };
  }
}

export const ResizableVideo = Node.create({
  name: "video",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null
      },
      title: {
        default: null
      },
      widthPercent: {
        default: 100,
        parseHTML: (element: HTMLElement) =>
          Number(element.getAttribute("data-width-percent") ?? 100),
        renderHTML: (attributes: { widthPercent?: number }) => ({
          "data-width-percent": attributes.widthPercent ?? 100
        })
      },
      align: {
        default: "center",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-align") ?? "center",
        renderHTML: (attributes: { align?: string }) => ({
          "data-align": attributes.align ?? "center"
        })
      },
      uploadToken: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-upload-token"),
        renderHTML: (attributes: { uploadToken?: string | null }) =>
          attributes.uploadToken
            ? {
                "data-upload-token": attributes.uploadToken
              }
            : {}
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "video[src]"
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "video",
      mergeAttributes(HTMLAttributes, {
        controls: "true"
      })
    ];
  },

  addCommands() {
    return {
      setVideo:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              align: "center",
              widthPercent: 100,
              ...attributes
            }
          })
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => (
      <ResizableMediaNodeView {...props} mediaKind="video" />
    ));
  }
});
