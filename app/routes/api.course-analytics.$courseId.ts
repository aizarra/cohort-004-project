import { data } from "react-router";
import { and, isNotNull, sql, eq } from "drizzle-orm";
import type { Route } from "./+types/api.course-analytics.$courseId";
import { getCurrentUserId } from "~/lib/session";
import { getUserById } from "~/services/userService";
import { getCourseById } from "~/services/courseService";
import { UserRole, enrollments, purchases } from "~/db/schema";
import { db } from "~/db";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Returns the UTC Sunday that begins the ISO week containing `date`.
 * We use Sunday-based weeks so the label "Week of Mar 3" is unambiguous.
 */
function getWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back up to Sunday
  return d;
}

/**
 * Bucket key for a weekly bucket: the ISO date of that Sunday (YYYY-MM-DD).
 * Two dates in the same week share the same key.
 */
function weekKey(date: Date): string {
  return getWeekStart(date).toISOString().slice(0, 10);
}

/** Bucket key for a monthly bucket: "YYYY-MM". */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Human-readable label for a weekly key ("Week of Mar 3"). */
function weekLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/** Human-readable label for a monthly key ("Jan 2025"). */
function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

type TimeBucket = { label: string; enrollments: number; revenueCents: number };

/**
 * Builds a complete, ordered list of time buckets from `earliest` to now,
 * then fills each bucket with enrollment counts and revenue cents.
 *
 * Generating every bucket — even empty ones — is important for chart
 * continuity: a gap in the data becomes a visible zero bar, not a
 * misleading jump between non-adjacent labels.
 */
function buildTimeSeries(opts: {
  granularity: "weekly" | "monthly";
  earliest: Date;
  enrollmentDates: string[];
  purchaseRows: { createdAt: string; pricePaid: number }[];
}): TimeBucket[] {
  const { granularity, earliest, enrollmentDates, purchaseRows } = opts;
  const now = new Date();

  const toKey = (d: Date) => granularity === "weekly" ? weekKey(d) : monthKey(d);
  const toLabel = (key: string) => granularity === "weekly" ? weekLabel(key) : monthLabel(key);

  // --- Generate every bucket key from earliest to now ---
  const orderedKeys: string[] = [];
  if (granularity === "weekly") {
    let cursor = getWeekStart(earliest);
    const stop = getWeekStart(now);
    while (cursor <= stop) {
      orderedKeys.push(cursor.toISOString().slice(0, 10));
      cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
  } else {
    let y = earliest.getUTCFullYear();
    let m = earliest.getUTCMonth(); // 0-indexed
    const stopY = now.getUTCFullYear();
    const stopM = now.getUTCMonth();
    while (y < stopY || (y === stopY && m <= stopM)) {
      orderedKeys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      m++;
      if (m === 12) { m = 0; y++; }
    }
  }

  // --- Initialise all buckets to zero ---
  const map = new Map<string, TimeBucket>(
    orderedKeys.map((key) => [key, { label: toLabel(key), enrollments: 0, revenueCents: 0 }])
  );

  // --- Fill from real data (dates outside the generated range are ignored) ---
  for (const ts of enrollmentDates) {
    const bucket = map.get(toKey(new Date(ts)));
    if (bucket) bucket.enrollments++;
  }
  for (const { createdAt, pricePaid } of purchaseRows) {
    const bucket = map.get(toKey(new Date(createdAt)));
    if (bucket) bucket.revenueCents += pricePaid;
  }

  return orderedKeys.map((key) => map.get(key)!);
}

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

  // --- Time series ---
  // Find the earliest activity timestamp across enrollments and purchases.
  // This single value determines whether weekly or monthly granularity is
  // more appropriate: recent-only courses get weekly detail; older courses
  // get the wider monthly view.
  const earliestEnrollmentRow = db
    .select({ ts: sql<string | null>`min(enrolled_at)` })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
    .get();
  const earliestPurchaseRow = db
    .select({ ts: sql<string | null>`min(created_at)` })
    .from(purchases)
    .where(eq(purchases.courseId, courseId))
    .get();

  const candidates = [earliestEnrollmentRow?.ts, earliestPurchaseRow?.ts].filter(
    (ts): ts is string => typeof ts === "string"
  );
  const earliestTs = candidates.length > 0 ? candidates.sort()[0] : null;

  const granularity: "weekly" | "monthly" =
    earliestTs && Date.now() - new Date(earliestTs).getTime() <= NINETY_DAYS_MS
      ? "weekly"
      : "monthly";

  let timeSeries: TimeBucket[] = [];
  if (earliestTs) {
    const allEnrollmentDates = db
      .select({ enrolledAt: enrollments.enrolledAt })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
      .all()
      .map((r) => r.enrolledAt);

    const allPurchaseRows = db
      .select({ createdAt: purchases.createdAt, pricePaid: purchases.pricePaid })
      .from(purchases)
      .where(eq(purchases.courseId, courseId))
      .all();

    timeSeries = buildTimeSeries({
      granularity,
      earliest: new Date(earliestTs),
      enrollmentDates: allEnrollmentDates,
      purchaseRows: allPurchaseRows,
    });
  }

  return {
    totalEnrolled,
    totalRevenueCents,
    completionRate,
    granularity,
    timeSeries,
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
