import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, droppedLaunches, verdict } from "./vm-launcher-watch.ts";

const A1 = "VM.Standard.A1.Flex";
const MICRO = "VM.Standard.E2.1.Micro";
const vm = (shape: string, lifecycleState = "RUNNING", timeCreated = "2026-11-02T10:00:00Z", createdBy = "default/joutiya-launcher") => ({
  id: `ocid1.instance.${Math.random()}`,
  displayName: shape === A1 ? "joutiya-vm" : "spare-micro-1",
  shape,
  lifecycleState,
  timeCreated,
  definedTags: { "Oracle-Tags": { CreatedBy: createdBy } },
});
const healthy = { workerFound: true, cron: true, tailSeconds: 150 };

test("Worker log lines: out of capacity and throttling are the hunt, anything else is a failure", () => {
  assert.equal(classify("no launch (spare-micro-2): HTTP 500 InternalError Out of host capacity."), "capacity");
  assert.equal(classify("no launch (2 OCPU, 12 GB): HTTP 429 TooManyRequests Too many requests"), "capacity");
  assert.equal(classify("instances present (VM.Standard.A1.Flex RUNNING): nothing launched"), "idle");
  assert.equal(classify("launched spare-micro-2 PROVISIONING (VM.Standard.E2.1.Micro, ocid1.instance.x)"), "launched");
  assert.equal(classify("no launch (spare-micro-2): HTTP 400 QuotaExceeded standard-e2-micro-core-count"), "failure");
  assert.equal(classify("instance list failed: HTTP 401 NotAuthenticated"), "failure");
  assert.equal(classify("secrets missing: OCI_PRIVATE_KEY"), "failure");
});

test("a launch Oracle took and then terminated is an anomaly, older ones and other users' are not", () => {
  const since = new Date("2026-11-02T09:00:00Z");
  const dropped = droppedLaunches([vm(MICRO, "TERMINATED"), vm(MICRO, "TERMINATED", "2026-11-01T10:00:00Z"), vm(MICRO, "TERMINATED", undefined, "default/joutiya-claude"), vm(MICRO)], since);
  assert.equal(dropped.length, 1);
  const result = verdict({ alive: [vm(A1), vm(MICRO)], dropped, lines: ["no launch (spare-micro-2): HTTP 500 InternalError Out of host capacity."], ...healthy });
  assert.equal(result.status, "anomaly");
  assert.match(result.reasons[0] ?? "", /^1 launch\(es\) dropped by Oracle/);
});

test("verdicts: ok while hunting, done once both spares live, anomaly on a silent or missing Worker", () => {
  const hunting = ["no launch (spare-micro-2): HTTP 500 InternalError Out of host capacity."];
  assert.deepEqual(verdict({ alive: [vm(A1), vm(MICRO)], dropped: [], lines: hunting, ...healthy }), { status: "ok", reasons: [] });
  assert.equal(verdict({ alive: [vm(A1), vm(MICRO), vm(MICRO)], dropped: [], lines: ["instances present (x): nothing launched"], ...healthy }).status, "done");
  assert.match(verdict({ alive: [vm(A1)], dropped: [], lines: [], ...healthy }).reasons.join(), /no Worker run seen in 150 s/);
  assert.match(verdict({ alive: [vm(A1)], dropped: [], lines: [], ...healthy, cron: false }).reasons.join(), /no cron trigger/);
  assert.match(verdict({ alive: [vm(A1)], dropped: [], lines: [], ...healthy, workerFound: false }).reasons.join(), /not found/);
  assert.match(verdict({ alive: [vm(A1)], dropped: [], lines: ["instance list failed: HTTP 401 NotAuthenticated"], ...healthy }).reasons.join(), /failure lines: instance list failed/);
});
