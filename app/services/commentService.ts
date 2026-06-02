import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "~/db";
import { courses, lessonComments, lessons, modules, users } from "~/db/schema";

export const COMMENTS_PAGE_SIZE = 20;

export function getCommentCount(lessonId: number): number {
  return (
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(lessonComments)
      .where(
        and(
          eq(lessonComments.lessonId, lessonId),
          isNull(lessonComments.parentId),
          isNull(lessonComments.deletedAt)
        )
      )
      .get()?.count ?? 0
  );
}

type CommentRow = {
  id: number;
  lessonId: number;
  userId: number;
  parentId: number | null;
  body: string;
  deletedAt: string | null;
  createdAt: string;
  authorName: string;
  authorAvatarUrl: string | null;
};

export type CommentWithReplies = CommentRow & {
  replies: CommentRow[];
};

function selectCommentFields() {
  return {
    id: lessonComments.id,
    lessonId: lessonComments.lessonId,
    userId: lessonComments.userId,
    parentId: lessonComments.parentId,
    body: lessonComments.body,
    deletedAt: lessonComments.deletedAt,
    createdAt: lessonComments.createdAt,
    authorName: users.name,
    authorAvatarUrl: users.avatarUrl,
  };
}

export function getLessonComments(
  lessonId: number,
  offset: number = 0,
  limit: number = COMMENTS_PAGE_SIZE
): { comments: CommentWithReplies[]; hasMore: boolean; total: number } {
  const topLevel = db
    .select(selectCommentFields())
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(
      and(
        eq(lessonComments.lessonId, lessonId),
        isNull(lessonComments.parentId)
      )
    )
    .orderBy(asc(lessonComments.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  if (topLevel.length === 0) {
    const total =
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(lessonComments)
        .where(
          and(
            eq(lessonComments.lessonId, lessonId),
            isNull(lessonComments.parentId)
          )
        )
        .get()?.count ?? 0;
    return { comments: [], hasMore: false, total };
  }

  const topLevelIds = topLevel.map((c) => c.id);

  const replies = db
    .select(selectCommentFields())
    .from(lessonComments)
    .innerJoin(users, eq(lessonComments.userId, users.id))
    .where(inArray(lessonComments.parentId, topLevelIds))
    .orderBy(asc(lessonComments.createdAt))
    .all();

  const replyMap = new Map<number, CommentRow[]>();
  for (const reply of replies) {
    const pid = reply.parentId!;
    if (!replyMap.has(pid)) replyMap.set(pid, []);
    replyMap.get(pid)!.push(reply);
  }

  const total =
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(lessonComments)
      .where(
        and(
          eq(lessonComments.lessonId, lessonId),
          isNull(lessonComments.parentId)
        )
      )
      .get()?.count ?? 0;

  const comments: CommentWithReplies[] = topLevel.map((c) => ({
    ...c,
    replies: replyMap.get(c.id) ?? [],
  }));

  return { comments, hasMore: offset + limit < total, total };
}

export function createComment(
  userId: number,
  lessonId: number,
  body: string,
  parentId: number | null = null
) {
  return db
    .insert(lessonComments)
    .values({ userId, lessonId, body, parentId })
    .returning()
    .get();
}

export function getCommentById(id: number) {
  return db
    .select()
    .from(lessonComments)
    .where(eq(lessonComments.id, id))
    .get();
}

export function softDeleteComment(id: number) {
  return db
    .update(lessonComments)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(lessonComments.id, id))
    .returning()
    .get();
}

export function getCourseInstructorIdForLesson(
  lessonId: number
): number | null {
  return (
    db
      .select({ instructorId: courses.instructorId })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .innerJoin(courses, eq(modules.courseId, courses.id))
      .where(eq(lessons.id, lessonId))
      .get()?.instructorId ?? null
  );
}
