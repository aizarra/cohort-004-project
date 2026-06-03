import { z } from "zod";
import type { Route } from "./+types/api.lesson-comments";
import { getCurrentUserId } from "~/lib/session";
import { isUserEnrolled } from "~/services/enrollmentService";
import { renderCommentBody } from "~/lib/markdown.server";
import {
  COMMENTS_PAGE_SIZE,
  createComment,
  getCommentById,
  getCourseInstructorIdForLesson,
  getLessonComments,
  softDeleteComment,
} from "~/services/commentService";
import { getModuleById } from "~/services/moduleService";
import { getLessonById } from "~/services/lessonService";
import { parseFormData } from "~/lib/validation";

const createSchema = z.object({
  intent: z.literal("create"),
  lessonId: z.coerce.number().int().positive(),
  body: z.string().min(1).max(5000),
  parentId: z.coerce.number().int().positive().optional(),
});

const deleteSchema = z.object({
  intent: z.literal("delete"),
  commentId: z.coerce.number().int().positive(),
});

const emptyComments = { comments: [], hasMore: false, total: 0, offset: 0 };

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lessonId = Number(url.searchParams.get("lessonId"));
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (!lessonId || isNaN(lessonId)) {
    return emptyComments;
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    return emptyComments;
  }

  const lesson = getLessonById(lessonId);
  if (!lesson) {
    return emptyComments;
  }

  const mod = getModuleById(lesson.moduleId);
  if (!mod) {
    return emptyComments;
  }

  const enrolled = isUserEnrolled(currentUserId, mod.courseId);
  const instructorId = getCourseInstructorIdForLesson(lessonId);
  const isInstructor = currentUserId === instructorId;

  if (!enrolled && !isInstructor) {
    return emptyComments;
  }

  const { comments, hasMore, total } = getLessonComments(
    lessonId,
    offset,
    COMMENTS_PAGE_SIZE
  );

  // Render comment bodies server-side
  const rendered = await Promise.all(
    comments.map(async (comment) => ({
      ...comment,
      bodyHtml: comment.deletedAt
        ? null
        : await renderCommentBody(comment.body),
      replies: await Promise.all(
        comment.replies.map(async (reply) => ({
          ...reply,
          bodyHtml: reply.deletedAt
            ? null
            : await renderCommentBody(reply.body),
        }))
      ),
    }))
  );

  return { comments: rendered, hasMore, total, offset };
}

const failure = { success: false as const };

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    return failure;
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const parsed = parseFormData(formData, createSchema);
    if (!parsed.success) {
      return failure;
    }

    const { lessonId, body, parentId } = parsed.data;

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      return failure;
    }

    const mod = getModuleById(lesson.moduleId);
    if (!mod) {
      return failure;
    }

    const enrolled = isUserEnrolled(currentUserId, mod.courseId);
    const instructorId = getCourseInstructorIdForLesson(lessonId);
    const isInstructor = currentUserId === instructorId;

    if (!enrolled && !isInstructor) {
      return failure;
    }

    // If replying, verify parent exists and belongs to this lesson
    if (parentId !== undefined) {
      const parent = getCommentById(parentId);
      if (!parent || parent.lessonId !== lessonId || parent.parentId !== null) {
        return failure;
      }
    }

    const comment = createComment(
      currentUserId,
      lessonId,
      body,
      parentId ?? null
    );
    return { success: true as const, comment };
  }

  if (intent === "delete") {
    const parsed = parseFormData(formData, deleteSchema);
    if (!parsed.success) {
      return failure;
    }

    const { commentId } = parsed.data;
    const comment = getCommentById(commentId);

    if (!comment) {
      return failure;
    }

    const instructorId = getCourseInstructorIdForLesson(comment.lessonId);
    const isAuthor = comment.userId === currentUserId;
    const isInstructor = currentUserId === instructorId;

    if (!isAuthor && !isInstructor) {
      return failure;
    }

    softDeleteComment(commentId);
    return { success: true as const };
  }

  return failure;
}
