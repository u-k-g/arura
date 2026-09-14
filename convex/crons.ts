import { cronJobs, anyApi } from "convex/server";
const crons = cronJobs();
crons.interval(
  "archive inactive navigation entries",
  { minutes: 30 },
  anyApi.workspace.sweep,
);
export default crons;
