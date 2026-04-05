import { useEffect, useRef, useState, type ChangeEvent } from "react";
import imageCompression from "browser-image-compression";
import type { Editor as TiptapEditor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import { ResizableImage } from "@/extensions/resizable-image";
import { ResizableVideo } from "@/extensions/resizable-video";
import { ResizableYoutube } from "@/extensions/resizable-youtube";
import { cn } from "@/lib/utils";

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 10 * 1024 * 1024;
const EDITOR_CHANGE_DEBOUNCE_MS = 120;

type TaskRichEditorProps = {
  valueJson: string | null;
  textFallback: string;
  onChange: (payload: { json: string | null; text: string }) => void;
};

type ToolbarButtonProps = {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
};

function ToolbarButton({ label, disabled = false, active = false, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-md border px-2 py-1 text-xs transition-colors",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border bg-background text-foreground hover:border-primary/25 hover:bg-primary/5",
        disabled && "cursor-not-allowed opacity-50"
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

function resolveEditorContent(
  valueJson: string | null,
  textFallback: string
): JSONContent | string {
  if (valueJson) {
    try {
      return JSON.parse(valueJson) as JSONContent;
    } catch {
      return textFallback;
    }
  }

  return textFallback;
}

function parseEditorJson(valueJson: string): JSONContent | null {
  try {
    return JSON.parse(valueJson) as JSONContent;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isYoutubeUrl(url: string): boolean {
  return /(youtube\.com|youtu\.be)/i.test(url);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("读取文件失败"));
    };

    reader.onerror = () => {
      reject(new Error("读取文件失败"));
    };

    reader.readAsDataURL(file);
  });
}

function createUploadToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function replaceMediaSourceByUploadToken(
  editor: TiptapEditor,
  uploadToken: string,
  attributes: Record<string, string | number | null>
): boolean {
  return editor.commands.command(({ tr, state }) => {
    let updated = false;

    state.doc.descendants((node, position) => {
      if (node.attrs.uploadToken !== uploadToken) {
        return true;
      }

      tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        ...attributes
      });
      updated = true;
      return false;
    });

    return updated;
  });
}

function removeMediaByUploadToken(editor: TiptapEditor, uploadToken: string): boolean {
  return editor.commands.command(({ tr, state }) => {
    let removed = false;

    state.doc.descendants((node, position) => {
      if (node.attrs.uploadToken !== uploadToken) {
        return true;
      }

      tr.delete(position, position + node.nodeSize);
      removed = true;
      return false;
    });

    return removed;
  });
}

export function TaskRichEditor({ valueJson, textFallback, onChange }: TaskRichEditorProps) {
  const [mediaHint, setMediaHint] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const changeTimeoutRef = useRef<number | null>(null);
  const latestOnChangeRef = useRef(onChange);
  const lastSyncedPayloadRef = useRef<{
    json: string | null;
    text: string;
  }>({
    json: valueJson,
    text: textFallback
  });

  useEffect(() => {
    latestOnChangeRef.current = onChange;
  }, [onChange]);

  function flushEditorChange(currentEditor: TiptapEditor): void {
    const nextPayload = {
      json: JSON.stringify(currentEditor.getJSON()),
      text: currentEditor.getText()
    };

    if (
      nextPayload.json === lastSyncedPayloadRef.current.json &&
      nextPayload.text === lastSyncedPayloadRef.current.text
    ) {
      return;
    }

    lastSyncedPayloadRef.current = nextPayload;
    latestOnChangeRef.current(nextPayload);
  }

  function scheduleEditorChange(currentEditor: TiptapEditor): void {
    if (changeTimeoutRef.current !== null) {
      window.clearTimeout(changeTimeoutRef.current);
    }

    changeTimeoutRef.current = window.setTimeout(() => {
      flushEditorChange(currentEditor);
      changeTimeoutRef.current = null;
    }, EDITOR_CHANGE_DEBOUNCE_MS);
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank"
        }
      }),
      ResizableImage,
      ResizableVideo,
      ResizableYoutube.configure({
        controls: true
      })
    ],
    content: resolveEditorContent(valueJson, textFallback),
    editorProps: {
      attributes: {
        class:
          "min-h-40 rounded-b-lg border border-t-0 border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
      }
    },
    onUpdate({ editor: currentEditor }) {
      scheduleEditorChange(currentEditor);
    },
    onBlur({ editor: currentEditor }) {
      if (changeTimeoutRef.current !== null) {
        window.clearTimeout(changeTimeoutRef.current);
        changeTimeoutRef.current = null;
      }

      flushEditorChange(currentEditor);
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (
      valueJson === lastSyncedPayloadRef.current.json &&
      textFallback === lastSyncedPayloadRef.current.text
    ) {
      return;
    }

    if (changeTimeoutRef.current !== null) {
      window.clearTimeout(changeTimeoutRef.current);
      changeTimeoutRef.current = null;
    }

    if (valueJson) {
      const nextJson = parseEditorJson(valueJson);

      if (!nextJson) {
        if (editor.getText() !== textFallback) {
          editor.commands.setContent(textFallback, { emitUpdate: false });
        }
        return;
      }

      editor.commands.setContent(nextJson, { emitUpdate: false });
      lastSyncedPayloadRef.current = {
        json: valueJson,
        text: textFallback
      };
      return;
    }

    if (editor.getText() !== textFallback) {
      editor.commands.setContent(textFallback, { emitUpdate: false });
    }

    lastSyncedPayloadRef.current = {
      json: valueJson,
      text: textFallback
    };
  }, [editor, textFallback, valueJson]);

  useEffect(() => {
    return () => {
      if (changeTimeoutRef.current !== null) {
        window.clearTimeout(changeTimeoutRef.current);
      }
    };
  }, []);

  async function handleImageFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !editor) {
      return;
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setMediaHint(`图片过大，请选择小于 ${formatBytes(MAX_IMAGE_UPLOAD_BYTES)} 的文件。`);
      return;
    }

    const uploadToken = createUploadToken();
    const previewUrl = URL.createObjectURL(file);

    editor
      .chain()
      .focus()
      .insertContent({
        type: "image",
        attrs: {
          src: previewUrl,
          alt: file.name,
          title: file.name,
          widthPercent: 100,
          align: "center",
          uploadToken
        }
      })
      .run();

    try {
      const compressedImage = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        initialQuality: 0.8
      });
      const imageSource = await imageCompression.getDataUrlFromFile(compressedImage);

      replaceMediaSourceByUploadToken(editor, uploadToken, {
        src: imageSource,
        alt: file.name,
        title: file.name,
        uploadToken: null
      });
      setMediaHint(null);
    } catch {
      removeMediaByUploadToken(editor, uploadToken);
      setMediaHint("图片处理失败，请重试。");
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  }

  async function handleVideoFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !editor) {
      return;
    }

    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setMediaHint(`视频过大，请选择小于 ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)} 的文件。`);
      return;
    }

    const uploadToken = createUploadToken();
    const previewUrl = URL.createObjectURL(file);

    editor
      .chain()
      .focus()
      .insertContent({
        type: "video",
        attrs: {
          src: previewUrl,
          title: file.name,
          widthPercent: 100,
          align: "center",
          uploadToken
        }
      })
      .run();

    try {
      const videoSource = await readFileAsDataUrl(file);

      replaceMediaSourceByUploadToken(editor, uploadToken, {
        src: videoSource,
        title: file.name,
        uploadToken: null
      });
      setMediaHint(null);
    } catch {
      removeMediaByUploadToken(editor, uploadToken);
      setMediaHint("视频处理失败，请重试。");
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  }

  function handleInsertImageUrl(): void {
    if (!editor) {
      return;
    }

    const url = window.prompt("请输入图片 URL");

    if (!url) {
      return;
    }

    editor
      .chain()
      .focus()
      .setImage({
        src: url
      })
      .run();
    setMediaHint(null);
  }

  function handleInsertVideoUrl(): void {
    if (!editor) {
      return;
    }

    const url = window.prompt("请输入视频 URL");

    if (!url) {
      return;
    }

    if (isYoutubeUrl(url)) {
      editor
        .chain()
        .focus()
        .setYoutubeVideo({
          src: url,
          width: 640,
          height: 360
        })
        .run();
      setMediaHint(null);
      return;
    }

    editor
      .chain()
      .focus()
      .setVideo({
        src: url
      })
      .run();
    setMediaHint(null);
  }

  return (
    <div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleVideoFileChange}
      />

      <div className="flex flex-wrap gap-1 rounded-t-lg border border-input border-b-0 bg-muted/30 px-2 py-2">
        <ToolbarButton
          label="粗体"
          disabled={!editor}
          active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="斜体"
          disabled={!editor}
          active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="标题"
          disabled={!editor}
          active={editor?.isActive("heading", { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="无序列表"
          disabled={!editor}
          active={editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="链接"
          disabled={!editor}
          active={editor?.isActive("link")}
          onClick={() => {
            if (!editor) {
              return;
            }

            const url = window.prompt("请输入链接地址");

            if (!url) {
              return;
            }

            editor.chain().focus().setLink({ href: url }).run();
          }}
        />
        <ToolbarButton label="图片 URL" disabled={!editor} onClick={handleInsertImageUrl} />
        <ToolbarButton
          label="上传图片"
          disabled={!editor}
          onClick={() => imageInputRef.current?.click()}
        />
        <ToolbarButton label="视频 URL" disabled={!editor} onClick={handleInsertVideoUrl} />
        <ToolbarButton
          label="上传视频"
          disabled={!editor}
          onClick={() => videoInputRef.current?.click()}
        />
      </div>
      <EditorContent editor={editor} />
      {mediaHint ? <p className="mt-2 text-xs text-muted-foreground">{mediaHint}</p> : null}
    </div>
  );
}
