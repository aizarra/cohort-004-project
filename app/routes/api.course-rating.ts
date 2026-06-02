import { data } from "react-router";
import type { Route } from "./+types/api.course-rating";
import { getCurrentUserId } from "~/lib/session";
import { isUserEnrolled } from "~/services/enrollmentService";
import { getCourseById } from "~/services/courseService";
import { upsertCourseRating } from "~/services/reviewService";

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const courseId = Number(formData.get("courseId"));
  const rating = Number(formData.get("rating"));

  if (!courseId || !rating || rating < 1 || rating > 5) {
    throw data("Invalid input", { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const enrolled = isUserEnrolled(currentUserId, courseId);
  if (!enrolled) {
    throw data("Not enrolled in this course", { status: 403 });
  }

  const review = upsertCourseRating(currentUserId, courseId, rating);
  return { review };
}
