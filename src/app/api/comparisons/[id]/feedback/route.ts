import { NextResponse } from "next/server";
import {
  applyApiRateLimit,
  rateLimitedResponse,
} from "@/lib/apiRateLimit";
import { trackServerEvent } from "@/lib/analytics";
import { getRequestUser, type RequestUser } from "@/lib/request-user";
import { saveComparisonFeedback, StoreError } from "@/lib/store";
import { getRequestId, logRequestError } from "@/lib/requestLog";
import { visitorJson } from "@/lib/visitor";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseHelpful(payload: unknown): boolean | null {
  if (!isRecord(payload) || typeof payload.helpful !== "boolean") return null;
  return payload.helpful;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const requestId = getRequestId(request);
  let visitor: RequestUser;
  try {
    visitor = await getRequestUser(request);
  } catch (err) {
    logRequestError(requestId, `POST /api/comparisons/${id}/feedback failed`, err);
    return NextResponse.json({ error: "internal_error", requestId }, { status: 500 });
  }

  const limit = await applyApiRateLimit(request, {
    scope: "comparisons:feedback",
    limit: 60,
    windowMs: 60 * 60 * 1000,
    identifier: visitor.id,
  });
  if (limit.limited) {
    return rateLimitedResponse({ result: limit, requestId });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return visitorJson(visitor, { error: "invalid_json", requestId }, { status: 400 });
  }

  const helpful = parseHelpful(payload);
  if (helpful === null) {
    return visitorJson(
      visitor,
      { error: "invalid_input", message: "helpful must be true or false", requestId },
      { status: 400 },
    );
  }

  try {
    const feedback = await saveComparisonFeedback(visitor.id, {
      comparisonId: id,
      helpful,
    });
    trackServerEvent(helpful ? "result_helpful" : "result_unhelpful", {
      userId: visitor.id,
      comparisonId: id,
      feedbackId: feedback.id,
      requestId,
    });
    return visitorJson(visitor, { feedback, requestId }, { status: 201 });
  } catch (err) {
    if (err instanceof StoreError && err.code === "comparison_not_found") {
      return visitorJson(visitor, { error: "not_found", requestId }, { status: 404 });
    }
    logRequestError(requestId, `POST /api/comparisons/${id}/feedback failed`, err, {
      userId: visitor.id,
      comparisonId: id,
    });
    return visitorJson(visitor, { error: "internal_error", requestId }, { status: 500 });
  }
}
