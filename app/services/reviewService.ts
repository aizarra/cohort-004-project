import { and, eq, sql } from "drizzle-orm";
import { db } from "~/db";
import { courseReviews } from "~/db/schema";

export function getCourseAverageRating(courseId: number) {
  return db
    .select({
      avgRating: sql<number | null>`ROUND(AVG(${courseReviews.rating}), 1)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(courseReviews)
    .where(eq(courseReviews.courseId, courseId))
    .get();
}

export function getUserCourseRating(userId: number, courseId: number) {
  return db
    .select()
    .from(courseReviews)
    .where(
      and(
        eq(courseReviews.userId, userId),
        eq(courseReviews.courseId, courseId)
      )
    )
    .get();
}

export function upsertCourseRating(
  userId: number,
  courseId: number,
  rating: number
) {
  return db
    .insert(courseReviews)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseReviews.userId, courseReviews.courseId],
      set: { rating, createdAt: new Date().toISOString() },
    })
    .returning()
    .get();
}
