import Youtube from "@tiptap/extension-youtube";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ResizableMediaNodeView } from "@/components/editor/resizable-media-node-view";

export const ResizableYoutube = Youtube.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
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
      }
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer((props) => (
      <ResizableMediaNodeView {...props} mediaKind="youtube" />
    ));
  }
});
