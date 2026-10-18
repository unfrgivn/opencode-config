# Before and After Examples

## Plan Summary

**Before**

> This plan provides a comprehensive approach to improving observability across the platform. It is important because teams currently lack visibility into failures, which creates significant operational challenges moving forward.

**After**

> Teams cannot trace failed imports across API, worker, and database boundaries. This plan adds request IDs to each step so support can find the failing component without asking engineering to inspect logs manually.

## PR Description

**Before**

> This PR improves the user experience by adding robust validation and handling edge cases more seamlessly.

**After**

> This PR validates campaign names before save so users see the error in the form instead of getting a failed API response. It also keeps the submit button disabled while the save request is running.

## TRD Decision

**Before**

> The architecture isn't about adding another queue. It's about creating a more resilient ingestion layer that can scale with future needs.

**After**

> Use Pub/Sub between upload and import processing. The queue lets workers retry failed files without blocking new uploads, and it gives SRE a backlog metric for autoscaling.

## Status Update

**Before**

> We're making good progress and continuing to drive alignment with stakeholders. There are a few blockers, but the team is confident we can navigate them.

**After**

> API changes are merged. Frontend integration is blocked on the new response schema from Data Eng. We need that schema by Thursday to keep the beta on schedule.

## Incident Note

**Before**

> Latency was observed in the system, and mitigation steps were taken to restore normal operations.

**After**

> The import worker queue grew from 200 to 18,000 jobs between 10:05 and 10:42. SRE doubled worker capacity at 10:47, and the queue cleared by 11:20.
