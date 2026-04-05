import { useEffect, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/utils";

type MediaAlign = "left" | "center" | "right";
type MediaKind = "image" | "video" | "youtube";
type ResizeSide = "left" | "right";

type ResizableMediaNodeViewProps = NodeViewProps & {
  mediaKind: MediaKind;
};

type HandleDescriptor = {
  key: string;
  side: ResizeSide;
  className: string;
};

const HANDLE_DESCRIPTORS: HandleDescriptor[] = [
  {
    key: "top-left",
    side: "left",
    className: "-left-1.5 -top-1.5 cursor-ew-resize"
  },
  {
    key: "bottom-left",
    side: "left",
    className: "-bottom-1.5 -left-1.5 cursor-ew-resize"
  },
  {
    key: "top-right",
    side: "right",
    className: "-right-1.5 -top-1.5 cursor-ew-resize"
  },
  {
    key: "bottom-right",
    side: "right",
    className: "-bottom-1.5 -right-1.5 cursor-ew-resize"
  }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readWidthPercent(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (Number.isNaN(numericValue)) {
    return 100;
  }

  return clamp(numericValue, 25, 100);
}

function readAlign(value: unknown): MediaAlign {
  if (value === "left" || value === "right" || value === "center") {
    return value;
  }

  return "center";
}

function resolveAlignClass(align: MediaAlign): string {
  if (align === "left") {
    return "mr-auto";
  }

  if (align === "right") {
    return "ml-auto";
  }

  return "mx-auto";
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function ResizableMediaNodeView({
  editor,
  getPos,
  mediaKind,
  node,
  selected,
  updateAttributes
}: ResizableMediaNodeViewProps) {
  const [isResizing, setIsResizing] = useState(false);
  const mediaFrameRef = useRef<HTMLDivElement | null>(null);
  const cleanupResizeRef = useRef<(() => void) | null>(null);

  const widthPercent = readWidthPercent(node.attrs.widthPercent);
  const align = readAlign(node.attrs.align);
  const src = isStringValue(node.attrs.src) ? node.attrs.src : "";
  const alt = isStringValue(node.attrs.alt) ? node.attrs.alt : "";
  const title = isStringValue(node.attrs.title) ? node.attrs.title : "";
  const showControls = selected || isResizing;

  useEffect(() => {
    return () => {
      cleanupResizeRef.current?.();
    };
  }, []);

  function selectCurrentNode(): void {
    const position = getPos();

    if (typeof position !== "number") {
      return;
    }

    editor.chain().focus().setNodeSelection(position).run();
  }

  function applyAlign(nextAlign: MediaAlign): void {
    selectCurrentNode();
    updateAttributes({ align: nextAlign });
  }

  function startResize(side: ResizeSide) {
    return (event: React.PointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      event.stopPropagation();

      selectCurrentNode();

      const mediaFrame = mediaFrameRef.current;
      const editorRoot = mediaFrame?.closest(".ProseMirror") as HTMLElement | null;

      if (!mediaFrame || !editorRoot) {
        return;
      }

      const startX = event.clientX;
      const startWidth = mediaFrame.getBoundingClientRect().width;
      const maxWidth = Math.max(editorRoot.clientWidth - 24, 240);

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const delta = moveEvent.clientX - startX;
        const resizedWidth = side === "right" ? startWidth + delta : startWidth - delta;
        const nextWidth = clamp(resizedWidth, 180, maxWidth);
        const nextWidthPercent = clamp((nextWidth / maxWidth) * 100, 25, 100);

        updateAttributes({
          widthPercent: Math.round(nextWidthPercent)
        });
      };

      const handlePointerUp = (): void => {
        cleanupResizeRef.current?.();
        cleanupResizeRef.current = null;
        setIsResizing(false);
      };

      cleanupResizeRef.current = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
      setIsResizing(true);
    };
  }

  function renderMediaContent() {
    if (mediaKind === "image") {
      return (
        <img
          src={src}
          alt={alt}
          title={title}
          draggable={false}
          className="block h-auto w-full rounded-xl object-contain"
        />
      );
    }

    if (mediaKind === "youtube") {
      return (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe
            src={src}
            title={title || "????"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>
      );
    }

    return (
      <video src={src} title={title} controls className="block h-auto w-full rounded-xl bg-black" />
    );
  }

  return (
    <NodeViewWrapper className="my-4" contentEditable={false}>
      <div
        ref={mediaFrameRef}
        className={cn("relative transition-[width] duration-150", resolveAlignClass(align))}
        style={{ width: `${widthPercent}%` }}
        onMouseDown={selectCurrentNode}
      >
        {showControls ? (
          <div className="absolute left-0 top-0 z-20 flex -translate-y-[calc(100%+8px)] items-center gap-1 rounded-lg border border-border bg-card/95 px-2 py-1 shadow-sm backdrop-blur">
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                align === "left"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => applyAlign("left")}
            >
              ?
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                align === "center"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => applyAlign("center")}
            >
              ?
            </button>
            <button
              type="button"
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                align === "right"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              onClick={() => applyAlign("right")}
            >
              ?
            </button>
            <span className="pl-1 text-[11px] text-muted-foreground">{widthPercent}%</span>
          </div>
        ) : null}

        <div
          className={cn(
            "relative rounded-xl border bg-muted/20 transition-colors",
            showControls ? "border-primary/40 ring-2 ring-primary/20" : "border-border/70"
          )}
        >
          {(mediaKind === "video" || mediaKind === "youtube") && !showControls ? (
            <button
              type="button"
              aria-label="????"
              className="absolute inset-0 z-10 rounded-xl"
              onClick={selectCurrentNode}
            />
          ) : null}

          {renderMediaContent()}
        </div>

        {showControls
          ? HANDLE_DESCRIPTORS.map((handle) => (
              <button
                key={handle.key}
                type="button"
                aria-label="??????"
                className={cn(
                  "absolute z-20 h-3 w-3 rounded-full border border-background bg-primary shadow-sm",
                  handle.className
                )}
                onPointerDown={startResize(handle.side)}
              />
            ))
          : null}
      </div>
    </NodeViewWrapper>
  );
}
