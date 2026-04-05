import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import imageCompression from "browser-image-compression";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Youtube from "@tiptap/extension-youtube";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import { cn } from "@/lib/utils";

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_BYTES = 10 * 1024 * 1024;

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function TaskRichEditor({ valueJson, textFallback, onChange }: TaskRichEditorProps) {
  const [mediaHint, setMediaHint] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const content = useMemo(
    () => resolveEditorContent(valueJson, textFallback),
    [valueJson, textFallback]
  );

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
      Image,
      Youtube.configure({
        controls: true
      })
    ],
    content,
    editorProps: {
      attributes: {
        class:
          "min-h-40 rounded-b-lg border border-t-0 border-input bg-background px-3 py-2 text-sm text-foreground outline-none"
      }
    },
    onUpdate({ editor: currentEditor }) {
      const nextJson = JSON.stringify(currentEditor.getJSON());
      const nextText = currentEditor.getText();
      onChange({ json: nextJson, text: nextText });
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

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

    try {
      const compressedImage = await imageCompression(file, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
        initialQuality: 0.8
      });

      const imageSource = await imageCompression.getDataUrlFromFile(compressedImage);
      editor.chain().focus().setImage({ src: imageSource, alt: file.name }).run();

      setMediaHint(
        `图片已插入：${formatBytes(file.size)} -> ${formatBytes(compressedImage.size)}。`
      );
    } catch {
      setMediaHint("图片处理失败，请重试。");
    }
  }

  function handleVideoFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !editor) {
      return;
    }

    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setMediaHint(`视频过大，请选择小于 ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)} 的文件。`);
      return;
    }

    editor
      .chain()
      .focus()
      .insertContent(`\n[视频待上传] ${file.name}（${formatBytes(file.size)}）\n`)
      .run();
    setMediaHint("视频已通过大小校验并插入占位文本，正式上传接口将在后续接入。");
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
        <ToolbarButton
          label="图片URL"
          disabled={!editor}
          onClick={() => {
            if (!editor) {
              return;
            }

            const url = window.prompt("请输入图片 URL");
            if (!url) {
              return;
            }

            editor.chain().focus().setImage({ src: url }).run();
          }}
        />
        <ToolbarButton
          label="上传图片"
          disabled={!editor}
          onClick={() => imageInputRef.current?.click()}
        />
        <ToolbarButton
          label="视频URL"
          disabled={!editor}
          onClick={() => {
            if (!editor) {
              return;
            }

            const url = window.prompt("请输入视频 URL（当前支持 YouTube）");
            if (!url) {
              return;
            }

            editor.chain().focus().setYoutubeVideo({ src: url }).run();
          }}
        />
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
