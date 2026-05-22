import { auth } from "@/auth";
import { listComments, type EntityType } from "@/lib/comments";
import { CommentForm } from "./comment-form";
import { deleteCommentAction } from "@/app/actions/comments";

type Props = {
  entityType: EntityType;
  entityId: string;
  entityName: string;
};

function timeAgo(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}일 전`;
  return isoStr.slice(0, 10);
}

export async function CommentSection({ entityType, entityId, entityName }: Props) {
  const [session, comments] = await Promise.all([
    auth(),
    listComments(entityType, entityId),
  ]);
  const userId = session?.user?.id ?? null;

  return (
    <section className="mt-10 border-t border-primary/10 pt-6">
      <h2 className="mb-4 font-serif text-xl font-bold text-primary">
        댓글 <span className="text-sm font-mono font-normal text-muted-foreground">{comments.length}</span>
      </h2>

      {userId ? (
        <div className="mb-6">
          <CommentForm entityType={entityType} entityId={entityId} entityName={entityName} />
        </div>
      ) : (
        <p className="mb-6 rounded-lg border border-primary/10 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          댓글을 남기려면{" "}
          <a href="/login" className="font-semibold text-primary underline underline-offset-2">
            로그인
          </a>
          이 필요합니다.
        </p>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">아직 댓글이 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-primary/8 bg-white p-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">
                  {c.author_name ?? "알 수 없음"}
                </span>
                <div className="flex items-center gap-2">
                  <time className="text-[10px] text-muted-foreground" dateTime={c.created_at}>
                    {timeAgo(c.created_at)}
                  </time>
                  {userId === c.user_id && (
                    <form
                      action={async () => {
                        "use server";
                        await deleteCommentAction(c.id);
                      }}
                    >
                      <button
                        type="submit"
                        className="text-[10px] text-muted-foreground hover:text-destructive transition"
                      >
                        삭제
                      </button>
                    </form>
                  )}
                </div>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words text-foreground/80">{c.content}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
