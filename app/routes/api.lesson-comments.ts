import { data } from "react-router";
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
import { getCourseById } from "~/services/courseService";
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

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const lessonId = Number(url.searchParams.get("lessonId"));
  const offset = Number(url.searchParams.get("offset") ?? "0");

  if (!lessonId || isNaN(lessonId)) {
    throw data("Invalid lessonId", { status: 400 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const lesson = getLessonById(lessonId);
  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }

  const mod = getModuleById(lesson.moduleId);
  if (!mod) {
    throw data("Module not found", { status: 404 });
  }

  const enrolled = isUserEnrolled(currentUserId, mod.courseId);
  const instructorId = getCourseInstructorIdForLesson(lessonId);
  const isInstructor = currentUserId === instructorId;

  if (!enrolled && !isInstructor) {
    throw data("Forbidden", { status: 403 });
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

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create") {
    const parsed = parseFormData(formData, createSchema);
    if (!parsed.success) {
      throw data("Invalid input", { status: 400 });
    }

    const { lessonId, body, parentId } = parsed.data;

    const lesson = getLessonById(lessonId);
    if (!lesson) {
      throw data("Lesson not found", { status: 404 });
    }

    const mod = getModuleById(lesson.moduleId);
    if (!mod) {
      throw data("Module not found", { status: 404 });
    }

    const enrolled = isUserEnrolled(currentUserId, mod.courseId);
    const instructorId = getCourseInstructorIdForLesson(lessonId);
    const isInstructor = currentUserId === instructorId;

    if (!enrolled && !isInstructor) {
      throw data("Forbidden", { status: 403 });
    }

    // If replying, verify parent exists and belongs to this lesson
    if (parentId !== undefined) {
      const parent = getCommentById(parentId);
      if (!parent || parent.lessonId !== lessonId || parent.parentId !== null) {
        throw data("Invalid parent comment", { status: 400 });
      }
    }

    const comment = createComment(
      currentUserId,
      lessonId,
      body,
      parentId ?? null
    );
    return { success: true, comment };
  }

  if (intent === "delete") {
    const parsed = parseFormData(formData, deleteSchema);
    if (!parsed.success) {
      throw data("Invalid input", { status: 400 });
    }

    const { commentId } = parsed.data;
    const comment = getCommentById(commentId);

    if (!comment) {
      throw data("Comment not found", { status: 404 });
    }

    const instructorId = getCourseInstructorIdForLesson(comment.lessonId);
    const isAuthor = comment.userId === currentUserId;
    const isInstructor = currentUserId === instructorId;

    if (!isAuthor && !isInstructor) {
      throw data("Forbidden", { status: 403 });
    }

    softDeleteComment(commentId);
    return { success: true };
  }

  throw data("Invalid intent", { status: 400 });
}
