import { data } from "react-router";
import { and, isNotNull, sql, eq } from "drizzle-orm";
import type { Route } from "./+types/api.course-analytics.$courseId";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCourseById } from "~/services/courseService";
import { UserRole, enrollments, purchases } from "~/db/schema";
import { db } from "~/db";

export async function loader({ params, request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    return data({ error: "Unauthorized" }, { status: 401 });
  }

  const user = getUserById(currentUserId);
  if (!user || (user.role !== UserRole.Instructor && user.role !== UserRole.Admin)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  const courseId = parseInt(params.courseId, 10);
  if (isNaN(courseId)) {
    return data({ error: "Invalid course ID" }, { status: 400 });
  }

  const course = getCourseById(courseId);
  if (!course) {
    return data({ error: "Course not found" }, { status: 404 });
  }

  if (course.instructorId !== currentUserId && user.role !== UserRole.Admin) {
    return data({ error: "Forbidden" }, { status: 403 });
  }

  const enrolledResult = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();
  const totalEnrolled = enrolledResult?.count ?? 0;

  const revenueResult = db
    .select({ total: sql<number>`coalesce(sum(price_paid), 0)` })
    .from(purchases)
    .where(eq(purchases.courseId, courseId))
    .get();
  const totalRevenueCents = revenueResult?.total ?? 0;

  const completedResult = db
    .select({ count: sql<number>`count(*)` })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, courseId), isNotNull(enrollments.completedAt)))
    .get();
  const completedCount = completedResult?.count ?? 0;
  const completionRate = totalEnrolled > 0 ? (completedCount / totalEnrolled) * 100 : 0;

  return {
    totalEnrolled,
    totalRevenueCents,
    completionRate,
    granularity: "monthly" as const,
    timeSeries: [] as Array<{ label: string; enrollments: number; revenueCents: number }>,
    lessonDropoff: [] as Array<{ lessonId: number; title: string; completionRate: number }>,
    quizDistributions: [] as Array<{
      quizId: number;
      quizTitle: string;
      lessonTitle: string;
      passingScore: number;
      buckets: [number, number, number, number, number];
      totalAttempted: number;
    }>,
  };
}
