import { useEffect, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Youtube from "@tiptap/extension-youtube";
import { cn } from "@/lib/utils";

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

export function TaskRichEditor({ valueJson, textFallback, onChange }: TaskRichEditorProps) {
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

  return (
    <div>
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
          label="图片"
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
          label="视频"
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
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
