"use client";

import * as React from "react";
import { addTaskCommentAction, deleteTaskAttachmentAction, getTaskDiscussionAction, uploadTaskAttachmentAction, type TaskDiscussionItem, type TaskAttachmentItem } from "@/modules/operations/actions";

export function TaskDiscussion({ taskId }: { taskId: string }) {
  const [comments, setComments] = React.useState<TaskDiscussionItem[]>([]);
  const [attachments, setAttachments] = React.useState<TaskAttachmentItem[]>([]);
  const [body, setBody] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const result = await getTaskDiscussionAction(taskId);
      setComments(result.comments);
      setAttachments(result.attachments);
    } catch {
      setFeedback("Diskusi belum dapat dimuat.");
    }
  }, [taskId]);

  React.useEffect(() => { load(); }, [load]);

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    try {
      const result = await addTaskCommentAction(taskId, body, []);
      setFeedback(result.message);
      if (result.success) { setBody(""); await load(); }
    } catch {
      setFeedback("Komentar belum dapat dikirim. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("taskId", taskId);
    form.set("file", file);
    setLoading(true);
    try {
      const result = await uploadTaskAttachmentAction(form);
      setFeedback(result.message);
      if (result.success) await load();
    } catch {
      setFeedback("Lampiran belum dapat diunggah. Silakan coba lagi.");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const removeAttachment = async (attachment: TaskAttachmentItem) => {
    if (!window.confirm(`Hapus lampiran "${attachment.fileName}"?`)) return;
    setLoading(true);
    try {
      const result = await deleteTaskAttachmentAction(attachment.id);
      setFeedback(result.message);
      if (result.success) await load();
    } catch {
      setFeedback("Lampiran belum dapat dihapus. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-container-low p-3 space-y-3" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between"><p className="text-xs font-semibold text-on-surface">Diskusi &amp; lampiran</p><label className="cursor-pointer text-xs text-primary font-semibold hover:underline"><span className="material-symbols-outlined text-[15px] align-middle mr-1">attach_file</span>Lampirkan<input type="file" className="sr-only" onChange={upload} disabled={loading} /></label></div>
      {comments.length === 0 && attachments.length === 0 ? <p className="text-xs text-muted-foreground">Belum ada komentar. Gunakan @mention di teks komentar bila perlu ditindaklanjuti.</p> : <div className="space-y-2 max-h-48 overflow-y-auto">{comments.map((comment) => <div key={comment.id} className="rounded-lg bg-card border border-border/60 p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-on-surface">{comment.authorName}</span><time className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("id-ID")}</time></div><p className="text-xs text-on-surface-variant whitespace-pre-wrap mt-1">{comment.body}</p>{comment.mentions.length > 0 && <p className="text-[10px] text-primary mt-1">Mention: {comment.mentions.join(", ")}</p>}</div>)}{attachments.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-lg bg-card border border-border/60 p-2 text-xs"><a href={file.signedUrl || "#"} target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-2 text-primary hover:underline"><span className="material-symbols-outlined text-[16px]">description</span><span className="truncate">{file.fileName}</span><span className="text-[10px] text-muted-foreground ml-auto">{Math.ceil(file.sizeBytes / 1024)} KB</span></a><button type="button" onClick={() => removeAttachment(file)} disabled={loading} className="text-[10px] text-destructive hover:underline disabled:opacity-50">Hapus</button></div>)}</div>}
      <form onSubmit={submitComment} className="flex gap-2"><input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Tulis komentar atau @mention…" className="min-w-0 flex-1 h-9 rounded-lg border border-border bg-card px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary" /><button type="submit" disabled={loading || !body.trim()} className="h-9 px-3 rounded-lg bg-primary text-on-primary text-xs font-semibold disabled:opacity-50">Kirim</button></form>
      {feedback && <p className="text-[10px] text-muted-foreground" aria-live="polite">{feedback}</p>}
    </div>
  );
}
