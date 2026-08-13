import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "node:crypto";
import { buildAgentPlan, readAgentPlan } from "./plan";
import { buildAgentVerifyReport } from "./verify";
import type {
  AgentApplyAction,
  AgentApplyReport,
  AgentOperation,
  AgentOperationInput,
  AgentOperationReceipt,
  AgentPlan,
  AgentRollbackReceipt,
  AgentRollbackResult,
  AgentVerificationStep,
  ApplyReceipt,
  BuildAgentApplyOptions,
  BuildExecutableAgentPlanOptions,
} from "./types";

const DEFAULT_PLAN_PATH = ".mandu/agent-plan.json";
const APPLY_REPORT_PATH = ".mandu/agent-apply.json";
const RECEIPTS_DIR = ".mandu/agent-receipts";
const SNAPSHOTS_DIR = ".mandu/agent-snapshots";
const LOCKS_DIR = ".mandu/agent-locks";
const MAX_OPERATION_BYTES = 2 * 1024 * 1024;
const CREATE_KINDS = new Set<AgentOperation["kind"]>([
  "file.create",
  "route.create",
  "api.create",
]);
const MODIFY_KINDS = new Set<AgentOperation["kind"]>([
  "file.patch-with-hash",
  "contract.update",
  "guard.safe-fix",
]);
const OPERATION_KINDS = new Set<AgentOperation["kind"]>([
  ...CREATE_KINDS,
  ...MODIFY_KINDS,
  "generated.refresh",
]);

interface FileState {
  exists: boolean;
  hash: string | null;
  content: Buffer | null;
  mode: number | null;
}

interface AgentSnapshotFile {
  path: string;
  existed: boolean;
  contentBase64: string | null;
  mode: number | null;
  expectedAfterHash: string;
  createdDirectories: string[];
}

interface AgentSnapshot {
  schemaVersion: 1;
  id: string;
  planId: string;
  createdAt: string;
  files: AgentSnapshotFile[];
}

class ApplyFailure extends Error {
  constructor(
    message: string,
    readonly operationId?: string,
  ) {
    super(message);
    this.name = "ApplyFailure";
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashAgentContent(content: string | Buffer): string {
  return sha256(content);
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isSensitiveTarget(target: string): boolean {
  const first = target.split("/")[0]?.toLowerCase();
  if (first === ".git" || first === "node_modules") return true;
  if (first === ".env" || first?.startsWith(".env.")) return true;
  return [
    ".mandu/agent-plan.json",
    ".mandu/agent-apply.json",
    ".mandu/agent-receipts",
    ".mandu/agent-snapshots",
    ".mandu/agent-locks",
  ].some((blocked) => target === blocked || target.startsWith(`${blocked}/`));
}

export function normalizeAgentTarget(value: string): string {
  if (!value || value.includes("\0")) {
    throw new Error("operation target must be a non-empty relative path");
  }
  const slashed = toPosix(value);
  if (path.posix.isAbsolute(slashed) || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`operation target must be relative: ${value}`);
  }
  const normalized = path.posix.normalize(slashed).replace(/^\.\//, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`operation target escapes the project root: ${value}`);
  }
  if (isSensitiveTarget(normalized)) {
    throw new Error(`operation target is protected: ${normalized}`);
  }
  return normalized;
}

function resolveInside(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const comparableResolved = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (
    comparableResolved !== comparableRoot &&
    !comparableResolved.startsWith(`${comparableRoot}${path.sep}`)
  ) {
    throw new Error("agent path must stay inside the project root");
  }
  return resolved;
}

async function assertNoSymlinkTraversal(rootDir: string, relativePath: string): Promise<void> {
  const segments = toPosix(relativePath).split("/").filter(Boolean);
  let current = path.resolve(rootDir);
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`symbolic links are not writable apply targets: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function fileState(rootDir: string, target: string): Promise<FileState> {
  await assertNoSymlinkTraversal(rootDir, target);
  const absolute = resolveInside(rootDir, target);
  try {
    const stat = await fs.lstat(absolute);
    if (!stat.isFile()) {
      throw new Error(`operation target must be a regular file: ${target}`);
    }
    const content = await fs.readFile(absolute);
    return {
      exists: true,
      hash: sha256(content),
      content,
      mode: stat.mode,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, hash: null, content: null, mode: null };
    }
    throw error;
  }
}

export async function computeAgentBaseRevision(
  rootDir: string,
  scope: string[],
): Promise<string> {
  const normalized = [...new Set(scope.map(normalizeAgentTarget))].sort();
  const hash = createHash("sha256");
  for (const target of normalized) {
    const state = await fileState(rootDir, target);
    hash.update(target);
    hash.update("\0");
    hash.update(state.exists ? state.hash! : "<absent>");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function defaultTypedVerification(): AgentVerificationStep[] {
  return [
    {
      id: "agent-verify",
      kind: "agent.verify",
      command: "mandu agent verify --changed --json --write",
      reason: "Canonical post-apply architecture and contract verification.",
      required: true,
      changedOnly: true,
      includeDiagnose: false,
      includeGit: true,
      includeGuard: true,
      includeContract: true,
    },
  ];
}

function assertEffect(input: AgentOperationInput): void {
  if (!OPERATION_KINDS.has(input.kind)) {
    throw new Error(`${input.id ?? input.target}: unsupported operation kind`);
  }
  if (input.effect?.type !== "write" || input.effect.encoding !== "utf8") {
    throw new Error(`${input.id ?? input.target}: only UTF-8 write effects are supported`);
  }
  if (typeof input.effect.content !== "string") {
    throw new Error(`${input.id ?? input.target}: effect.content must be a string`);
  }
  if (Buffer.byteLength(input.effect.content, "utf8") > MAX_OPERATION_BYTES) {
    throw new Error(`${input.id ?? input.target}: operation content exceeds 2 MiB`);
  }
}

export async function buildExecutableAgentPlan(
  rootDir: string,
  options: BuildExecutableAgentPlanOptions,
): Promise<AgentPlan> {
  if (options.operations.length === 0) {
    throw new Error("an executable agent plan requires at least one typed operation");
  }

  const preview = buildAgentPlan({ intent: options.intent });
  const operations: AgentOperation[] = [];
  const seenTargets = new Set<string>();
  const seenIds = new Set<string>();

  for (const [index, input] of options.operations.entries()) {
    assertEffect(input);
    const target = normalizeAgentTarget(input.target);
    const id = input.id?.trim() || `op-${index + 1}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) {
      throw new Error(`invalid operation id: ${id}`);
    }
    if (seenIds.has(id)) throw new Error(`duplicate operation id: ${id}`);
    if (seenTargets.has(target)) throw new Error(`duplicate operation target: ${target}`);
    seenIds.add(id);
    seenTargets.add(target);

    const state = await fileState(rootDir, target);
    if (CREATE_KINDS.has(input.kind) && state.exists) {
      throw new Error(`${input.kind} requires an absent target: ${target}`);
    }
    if (MODIFY_KINDS.has(input.kind) && !state.exists) {
      throw new Error(`${input.kind} requires an existing target: ${target}`);
    }

    operations.push({
      id,
      kind: input.kind,
      target,
      precondition: {
        exists: state.exists,
        ...(state.hash ? { contentHash: state.hash } : {}),
      },
      effect: input.effect,
      rollback: { strategy: "restore-snapshot" },
    });
  }

  const scope = operations.map((operation) => operation.target).sort();
  const baseRevision = await computeAgentBaseRevision(rootDir, scope);
  const idempotencyKey = options.idempotencyKey?.trim() || randomUUID();
  const rollbackPolicy = options.rollbackPolicy ?? "automatic";
  const permissions = scope.map((target) => ({ kind: "write" as const, path: target }));
  const verification = options.verification ?? defaultTypedVerification();
  const identity = sha256(JSON.stringify({
    intent: options.intent.trim(),
    baseRevision,
    idempotencyKey,
    scope,
    permissions,
    operations,
    rollbackPolicy,
    verification,
  })).slice(0, 24);

  return {
    ...preview,
    generatedAt: new Date().toISOString(),
    id: `plan-${identity}`,
    baseRevision,
    idempotencyKey,
    scope,
    permissions,
    operations,
    rollbackPolicy,
    filesToCreate: operations
      .filter((operation) => !operation.precondition.exists)
      .map((operation) => operation.target),
    filesToModify: operations
      .filter((operation) => operation.precondition.exists)
      .map((operation) => operation.target),
    verification,
    notes: [
      "Executable typed plan: apply enforces scope, revision, per-file hashes, snapshot rollback, and idempotency.",
      "Arbitrary shell commands are never executed by typed apply.",
    ],
    executable: true,
  };
}

function kindTargetIssue(operation: AgentOperation): string | null {
  if (operation.kind === "route.create" && !/^app\/(?:.+\/)?page\.tsx?$/.test(operation.target)) {
    return `${operation.id}: route.create target must be app/**/page.ts or page.tsx`;
  }
  if (operation.kind === "api.create" && !/^app\/api\/(?:.*\/)?route\.tsx?$/.test(operation.target)) {
    return `${operation.id}: api.create target must be app/api/**/route.ts or route.tsx`;
  }
  if (
    operation.kind === "contract.update" &&
    !/^spec\/contracts\/.+\.contract\.ts$/.test(operation.target)
  ) {
    return `${operation.id}: contract.update target must be spec/contracts/*.contract.ts`;
  }
  if (
    operation.kind === "guard.safe-fix" &&
    !/\.(?:[cm]?[jt]sx?|json)$/.test(operation.target)
  ) {
    return `${operation.id}: guard.safe-fix target must be a JS/TS/JSON source file`;
  }
  return null;
}

function validateExecutablePlan(plan: AgentPlan): string[] {
  const issues: string[] = [];
  if (!plan.executable) issues.push("plan is not executable");
  if (!/^plan-[a-f0-9]{24}$/.test(plan.id ?? "")) issues.push("plan.id is invalid");
  if (!/^[a-f0-9]{64}$/.test(plan.baseRevision ?? "")) issues.push("plan.baseRevision is invalid");
  if (!plan.idempotencyKey || plan.idempotencyKey.length > 128) {
    issues.push("plan.idempotencyKey is required and must be at most 128 characters");
  }
  if (plan.rollbackPolicy !== "automatic" && plan.rollbackPolicy !== "manual") {
    issues.push("plan.rollbackPolicy is invalid");
  }
  if (plan.baseRevision && plan.idempotencyKey) {
    const expectedPlanId = `plan-${sha256(JSON.stringify({
      intent: plan.intent,
      baseRevision: plan.baseRevision,
      idempotencyKey: plan.idempotencyKey,
      scope: plan.scope,
      permissions: plan.permissions,
      operations: plan.operations,
      rollbackPolicy: plan.rollbackPolicy,
      verification: plan.verification,
    })).slice(0, 24)}`;
    if (plan.id !== expectedPlanId) {
      issues.push("plan content does not match plan.id; bind a fresh executable plan");
    }
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    issues.push("plan.operations must contain at least one operation");
    return issues;
  }
  if (plan.operations.length > 100) issues.push("plan.operations exceeds the 100 operation limit");

  const scope = new Set<string>();
  for (const value of plan.scope ?? []) {
    try {
      scope.add(normalizeAgentTarget(value));
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  const writePermissions = new Set(
    (plan.permissions ?? [])
      .filter((permission) => permission.kind === "write")
      .map((permission) => {
        try {
          return normalizeAgentTarget(permission.path);
        } catch {
          return "<invalid>";
        }
      }),
  );
  const ids = new Set<string>();
  const targets = new Set<string>();

  for (const operation of plan.operations) {
    let target: string;
    try {
      target = normalizeAgentTarget(operation.target);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (target !== operation.target) issues.push(`${operation.id}: target must be normalized`);
    if (!OPERATION_KINDS.has(operation.kind)) {
      issues.push(`${operation.id}: unsupported operation kind`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(operation.id ?? "")) {
      issues.push(`invalid operation id: ${operation.id}`);
    }
    if (ids.has(operation.id)) issues.push(`duplicate operation id: ${operation.id}`);
    if (targets.has(target)) issues.push(`duplicate operation target: ${target}`);
    ids.add(operation.id);
    targets.add(target);
    if (!scope.has(target)) issues.push(`${operation.id}: target is outside plan scope`);
    if (!writePermissions.has(target)) issues.push(`${operation.id}: target lacks write permission`);
    if (operation.rollback?.strategy !== "restore-snapshot") {
      issues.push(`${operation.id}: unsupported rollback strategy`);
    }
    if (operation.effect?.type !== "write" || operation.effect.encoding !== "utf8") {
      issues.push(`${operation.id}: unsupported operation effect`);
    } else if (typeof operation.effect.content !== "string") {
      issues.push(`${operation.id}: effect.content must be a string`);
    } else if (Buffer.byteLength(operation.effect.content, "utf8") > MAX_OPERATION_BYTES) {
      issues.push(`${operation.id}: operation content exceeds 2 MiB`);
    }
    if (typeof operation.precondition?.exists !== "boolean") {
      issues.push(`${operation.id}: precondition.exists is required`);
    }
    if (
      operation.precondition?.contentHash !== undefined &&
      !/^[a-f0-9]{64}$/.test(operation.precondition.contentHash)
    ) {
      issues.push(`${operation.id}: precondition.contentHash is invalid`);
    }
    if (operation.precondition?.exists === true && !operation.precondition.contentHash) {
      issues.push(`${operation.id}: existing targets require a contentHash precondition`);
    }
    if (CREATE_KINDS.has(operation.kind) && operation.precondition?.exists !== false) {
      issues.push(`${operation.id}: create operation requires exists=false`);
    }
    if (
      MODIFY_KINDS.has(operation.kind) &&
      (operation.precondition?.exists !== true || !operation.precondition.contentHash)
    ) {
      issues.push(`${operation.id}: modifying operation requires exists=true and contentHash`);
    }
    const targetIssue = kindTargetIssue(operation);
    if (targetIssue) issues.push(targetIssue);
  }

  if (
    !Array.isArray(plan.verification) ||
    !plan.verification.some((step) => step.kind === "agent.verify" && step.required)
  ) {
    issues.push("executable plan requires at least one required typed agent.verify step");
  }
  for (const step of plan.verification ?? []) {
    if (step.kind !== "agent.verify") {
      issues.push(`${step.id}: executable plans only support agent.verify verification`);
    }
  }
  return issues;
}

async function preconditionIssues(rootDir: string, plan: AgentPlan): Promise<string[]> {
  const issues: string[] = [];
  try {
    const currentRevision = await computeAgentBaseRevision(rootDir, plan.scope);
    if (currentRevision !== plan.baseRevision) {
      issues.push(`base revision mismatch: expected ${plan.baseRevision}, received ${currentRevision}`);
    }
  } catch (error) {
    issues.push(`could not verify base revision: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const operation of plan.operations) {
    try {
      const state = await fileState(rootDir, operation.target);
      if (state.exists !== operation.precondition.exists) {
        issues.push(
          `${operation.id}: existence precondition mismatch for ${operation.target} ` +
          `(expected ${operation.precondition.exists}, received ${state.exists})`,
        );
      }
      if (
        operation.precondition.contentHash &&
        state.hash !== operation.precondition.contentHash
      ) {
        issues.push(
          `${operation.id}: content hash precondition mismatch for ${operation.target}`,
        );
      }
    } catch (error) {
      issues.push(
        `${operation.id}: could not verify ${operation.target}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return issues;
}

function emptyRollback(policy: AgentPlan["rollbackPolicy"] = "automatic"): AgentRollbackReceipt {
  return {
    id: null,
    snapshotPath: null,
    policy,
    attempted: false,
    ok: null,
    restoredFiles: [],
    conflicts: [],
  };
}

function receiptBase(
  sourcePlan: string,
  plan: AgentPlan | null,
  dryRun: boolean,
): ApplyReceipt {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    framework: "mandu",
    generatedAt: now,
    receiptId: `receipt-${randomUUID()}`,
    planId: plan?.id ?? null,
    idempotencyKey: plan?.idempotencyKey ?? null,
    baseRevision: plan?.baseRevision ?? null,
    startedAt: now,
    completedAt: now,
    ok: false,
    status: dryRun ? "preview" : "blocked",
    dryRun,
    replayed: false,
    sourcePlan,
    intent: plan?.intent ?? "",
    domains: plan?.domains ?? ["unknown"],
    actions: [],
    operations: [],
    touchedFiles: [],
    changedFiles: [],
    verification: [],
    rollback: emptyRollback(plan?.rollbackPolicy),
    warnings: [],
    nextVerifyCommand: "mandu agent verify --changed --json --write",
  };
}

function previewActions(plan: AgentPlan): AgentApplyAction[] {
  return [
    ...plan.filesToRead.map((file) => ({
      kind: "read_file" as const,
      description: `Read ${file} before editing.`,
      file,
      applied: false,
    })),
    ...plan.mcpTools.map((tool) => ({
      kind: "mcp_tool" as const,
      description: `Consider ${tool} for this plan.`,
      tool,
      applied: false,
    })),
    ...plan.filesToCreate.map((file) => ({
      kind: "manual_edit" as const,
      description: `Create ${file} only after confirming the local pattern.`,
      file,
      applied: false,
    })),
    ...plan.verification.map((item) => ({
      kind: "verify" as const,
      description: item.reason,
      command: item.command,
      applied: false,
    })),
  ];
}

function operationReceipts(plan: AgentPlan): AgentOperationReceipt[] {
  return plan.operations.map((operation) => ({
    operationId: operation.id,
    kind: operation.kind,
    target: operation.target,
    status: "planned",
    beforeHash: operation.precondition.contentHash ?? null,
    afterHash: sha256(operation.effect.content),
  }));
}

async function assertOperationPrecondition(
  rootDir: string,
  operation: AgentOperation,
): Promise<void> {
  const state = await fileState(rootDir, operation.target);
  if (state.exists !== operation.precondition.exists) {
    throw new ApplyFailure(
      `${operation.id}: existence changed after preflight for ${operation.target}`,
      operation.id,
    );
  }
  if (
    operation.precondition.contentHash &&
    state.hash !== operation.precondition.contentHash
  ) {
    throw new ApplyFailure(
      `${operation.id}: content changed after preflight for ${operation.target}`,
      operation.id,
    );
  }
}

async function writeBufferAtomic(
  rootDir: string,
  targetPath: string,
  content: string | Buffer,
): Promise<void> {
  await assertNoSymlinkTraversal(rootDir, targetPath);
  const target = resolveInside(rootDir, targetPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.mandu-${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temp, content, { flag: "wx" });
    await fs.rename(temp, target);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function writeAtomic(rootDir: string, operation: AgentOperation): Promise<void> {
  const state = await fileState(rootDir, operation.target);
  await writeBufferAtomic(rootDir, operation.target, operation.effect.content);
  if (state.mode !== null) {
    await fs.chmod(resolveInside(rootDir, operation.target), state.mode);
  }
}

async function writeJsonExclusive(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function receiptStorageKey(plan: AgentPlan): string {
  return sha256(`${plan.id}\0${plan.idempotencyKey}`).slice(0, 40);
}

function receiptPath(rootDir: string, plan: AgentPlan): string {
  return path.join(rootDir, RECEIPTS_DIR, `${receiptStorageKey(plan)}.json`);
}

function lockPath(rootDir: string, plan: AgentPlan): string {
  return path.join(rootDir, LOCKS_DIR, `${receiptStorageKey(plan)}.lock`);
}

function snapshotPath(rootDir: string, rollbackId: string): string {
  return path.join(rootDir, SNAPSHOTS_DIR, `${rollbackId}.json`);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function createSnapshot(rootDir: string, plan: AgentPlan): Promise<AgentSnapshot> {
  const id = `rollback-${randomUUID()}`;
  const files: AgentSnapshotFile[] = [];
  for (const operation of plan.operations) {
    const state = await fileState(rootDir, operation.target);
    const createdDirectories: string[] = [];
    const parent = path.posix.dirname(operation.target);
    if (parent !== ".") {
      let current = path.resolve(rootDir);
      let missing = false;
      const relativeParts: string[] = [];
      for (const segment of parent.split("/")) {
        relativeParts.push(segment);
        current = path.join(current, segment);
        if (!missing) {
          try {
            const stat = await fs.lstat(current);
            if (!stat.isDirectory()) {
              throw new Error(`operation parent is not a directory: ${relativeParts.join("/")}`);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            missing = true;
          }
        }
        if (missing) createdDirectories.push(relativeParts.join("/"));
      }
    }
    files.push({
      path: operation.target,
      existed: state.exists,
      contentBase64: state.content?.toString("base64") ?? null,
      mode: state.mode,
      expectedAfterHash: sha256(operation.effect.content),
      createdDirectories,
    });
  }
  const snapshot: AgentSnapshot = {
    schemaVersion: 1,
    id,
    planId: plan.id,
    createdAt: new Date().toISOString(),
    files,
  };
  await writeJsonExclusive(snapshotPath(rootDir, id), snapshot);
  return snapshot;
}

async function restoreSnapshot(
  rootDir: string,
  snapshot: AgentSnapshot,
  appliedTargets?: ReadonlySet<string>,
): Promise<AgentRollbackResult> {
  const restoredFiles: string[] = [];
  const conflicts: string[] = [];
  const directoriesToRemove = new Set<string>();

  for (let index = snapshot.files.length - 1; index >= 0; index -= 1) {
    const file = snapshot.files[index]!;
    if (appliedTargets && !appliedTargets.has(file.path)) continue;
    const current = await fileState(rootDir, file.path);
    if (current.hash !== file.expectedAfterHash) {
      conflicts.push(
        `${file.path}: current content no longer matches the content written by apply`,
      );
      continue;
    }

    const absolute = resolveInside(rootDir, file.path);
    if (!file.existed) {
      await fs.rm(absolute, { force: true });
      restoredFiles.push(file.path);
      for (const directory of file.createdDirectories) directoriesToRemove.add(directory);
      continue;
    }

    if (file.contentBase64 === null) {
      conflicts.push(`${file.path}: snapshot content is missing`);
      continue;
    }
    await writeBufferAtomic(rootDir, file.path, Buffer.from(file.contentBase64, "base64"));
    if (file.mode !== null) {
      await fs.chmod(absolute, file.mode);
    }
    restoredFiles.push(file.path);
  }

  const orderedDirectories = [...directoriesToRemove]
    .sort((left, right) => right.split("/").length - left.split("/").length);
  for (const directory of orderedDirectories) {
    try {
      await fs.rmdir(resolveInside(rootDir, directory));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") throw error;
    }
  }

  return {
    rollbackId: snapshot.id,
    ok: conflicts.length === 0,
    restoredFiles,
    conflicts,
  };
}

export async function rollbackAgentApply(
  rootDir: string,
  rollbackId: string,
): Promise<AgentRollbackResult> {
  if (!/^rollback-[0-9a-f-]{36}$/.test(rollbackId)) {
    throw new Error("invalid rollback id");
  }
  const snapshot = await readJson<AgentSnapshot>(snapshotPath(rootDir, rollbackId));
  if (!snapshot || snapshot.id !== rollbackId) {
    throw new Error(`rollback snapshot not found: ${rollbackId}`);
  }
  return restoreSnapshot(rootDir, snapshot);
}

async function runVerification(rootDir: string, plan: AgentPlan) {
  const results: ApplyReceipt["verification"] = [];
  for (const step of plan.verification) {
    if (step.kind !== "agent.verify") continue;
    const report = await buildAgentVerifyReport(rootDir, {
      changedOnly: step.changedOnly !== false,
      includeDiagnose: step.includeDiagnose === true,
      includeGit: step.includeGit !== false,
      includeGuard: step.includeGuard !== false,
      includeContract: step.includeContract !== false,
    });
    results.push({
      id: step.id,
      kind: "agent.verify",
      required: step.required,
      ok: report.ok,
      checks: report.checks,
      diagnostics: report.diagnostics,
    });
  }
  return results;
}

async function executePlan(
  rootDir: string,
  sourcePlan: string,
  plan: AgentPlan,
  options: BuildAgentApplyOptions,
): Promise<ApplyReceipt> {
  const storagePath = receiptPath(rootDir, plan);
  const existing = await readJson<ApplyReceipt>(storagePath);
  if (existing) {
    return { ...existing, replayed: true };
  }

  const executionLock = lockPath(rootDir, plan);
  await fs.mkdir(path.dirname(executionLock), { recursive: true });
  let lockHandle: fs.FileHandle | null = null;
  try {
    try {
      lockHandle = await fs.open(executionLock, "wx");
      await lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const blocked = receiptBase(sourcePlan, plan, false);
        blocked.warnings.push("An apply with the same plan and idempotency key is already running.");
        blocked.completedAt = new Date().toISOString();
        return blocked;
      }
      throw error;
    }

    const racedReceipt = await readJson<ApplyReceipt>(storagePath);
    if (racedReceipt) return { ...racedReceipt, replayed: true };

    const receipt = receiptBase(sourcePlan, plan, false);
    receipt.operations = operationReceipts(plan);
    receipt.touchedFiles = plan.operations.map((operation) => operation.target);
    receipt.actions = plan.operations.map((operation) => ({
      kind: operation.kind,
      description: `${operation.kind} ${operation.target}`,
      file: operation.target,
      applied: false,
    }));

    const structuralIssues = validateExecutablePlan(plan);
    if (structuralIssues.length > 0) {
      receipt.warnings.push(...structuralIssues);
      receipt.completedAt = new Date().toISOString();
      await writeJsonExclusive(storagePath, receipt);
      return receipt;
    }

    const stateIssues = await preconditionIssues(rootDir, plan);
    if (stateIssues.length > 0) {
      receipt.warnings.push(...stateIssues);
      receipt.completedAt = new Date().toISOString();
      await writeJsonExclusive(storagePath, receipt);
      return receipt;
    }

    let snapshot: AgentSnapshot;
    try {
      snapshot = await createSnapshot(rootDir, plan);
    } catch (error) {
      receipt.warnings.push(
        `could not create rollback snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      receipt.completedAt = new Date().toISOString();
      await writeJsonExclusive(storagePath, receipt);
      return receipt;
    }
    receipt.rollback.id = snapshot.id;
    receipt.rollback.snapshotPath = toPosix(path.relative(rootDir, snapshotPath(rootDir, snapshot.id)));

    try {
      for (const [index, operation] of plan.operations.entries()) {
        try {
          await assertOperationPrecondition(rootDir, operation);
          await writeAtomic(rootDir, operation);
          receipt.operations[index]!.status = "applied";
          receipt.actions[index]!.applied = true;
          receipt.changedFiles.push(operation.target);
          if (options.failureAfterOperations === index + 1) {
            throw new ApplyFailure(
              `injected apply failure after ${index + 1} operation(s)`,
              operation.id,
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (receipt.operations[index]!.status !== "applied") {
            receipt.operations[index]!.status = "failed";
            receipt.operations[index]!.error = message;
          }
          throw new ApplyFailure(message, operation.id);
        }
      }

      receipt.verification = await runVerification(rootDir, plan);
      const failedRequired = receipt.verification.find((result) => result.required && !result.ok);
      if (failedRequired) {
        throw new ApplyFailure(`required verification failed: ${failedRequired.id}`);
      }

      receipt.ok = true;
      receipt.status = "applied";
      receipt.completedAt = new Date().toISOString();
      await writeJsonExclusive(storagePath, receipt);
      return receipt;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      receipt.warnings.push(message);
      receipt.status = "failed";

      if (plan.rollbackPolicy === "automatic") {
        receipt.rollback.attempted = true;
        const appliedTargets = new Set(
          receipt.operations
            .filter((operation) => operation.status === "applied")
            .map((operation) => operation.target),
        );
        const rollback = await restoreSnapshot(rootDir, snapshot, appliedTargets);
        receipt.rollback.ok = rollback.ok;
        receipt.rollback.restoredFiles = rollback.restoredFiles;
        receipt.rollback.conflicts = rollback.conflicts;
        if (rollback.ok) {
          receipt.status = "rolled_back";
          receipt.changedFiles = [];
          for (const operation of receipt.operations) {
            if (operation.status === "applied") operation.status = "rolled_back";
          }
        }
      }

      receipt.completedAt = new Date().toISOString();
      await writeJsonExclusive(storagePath, receipt);
      return receipt;
    }
  } finally {
    await lockHandle?.close();
    if (lockHandle) await fs.rm(executionLock, { force: true });
  }
}

function compatibilityPreview(sourcePlan: string, plan: AgentPlan): AgentApplyReport {
  const receipt = receiptBase(sourcePlan, plan, true);
  receipt.ok = true;
  receipt.status = "preview";
  receipt.actions = previewActions(plan);
  receipt.warnings = [
    "This intent-only plan has no typed operations, so apply remains a compatibility preview.",
    "Create an executable plan with typed operations before requesting filesystem mutation.",
  ];
  return receipt;
}

export async function buildAgentApplyReport(
  rootDir: string = process.cwd(),
  options: BuildAgentApplyOptions = {},
): Promise<AgentApplyReport> {
  const sourceRel = options.from ?? DEFAULT_PLAN_PATH;
  let sourcePath: string;
  try {
    const normalizedSource = toPosix(sourceRel).replace(/^\.\//, "");
    sourcePath = resolveInside(rootDir, normalizedSource);
    await assertNoSymlinkTraversal(rootDir, normalizedSource);
  } catch (error) {
    const receipt = receiptBase(sourceRel, null, true);
    receipt.warnings.push(error instanceof Error ? error.message : String(error));
    return receipt;
  }

  const plan = await readAgentPlan(sourcePath);
  if (!plan) {
    const receipt = receiptBase(sourceRel, null, true);
    receipt.actions = [
      {
        kind: "verify",
        description: "Create an agent plan first.",
        command: "mandu agent plan \"<task>\" --json --write",
        applied: false,
      },
    ];
    receipt.warnings.push(`Could not read ${sourceRel}.`);
    return receipt;
  }

  if (!plan.executable || !Array.isArray(plan.operations) || plan.operations.length === 0) {
    return compatibilityPreview(sourceRel, plan);
  }

  const structuralIssues = validateExecutablePlan(plan);
  if (options.dryRun !== false) {
    const stateIssues = structuralIssues.length === 0
      ? await preconditionIssues(rootDir, plan)
      : [];
    const receipt = receiptBase(sourceRel, plan, true);
    receipt.operations = operationReceipts(plan);
    receipt.touchedFiles = plan.operations.map((operation) => operation.target);
    receipt.actions = plan.operations.map((operation) => ({
      kind: operation.kind,
      description: `${operation.kind} ${operation.target}`,
      file: operation.target,
      applied: false,
    }));
    receipt.ok = structuralIssues.length === 0 && stateIssues.length === 0;
    receipt.status = receipt.ok ? "preview" : "blocked";
    receipt.warnings = receipt.ok
      ? ["Typed apply preview only. No filesystem changes were made."]
      : [...structuralIssues, ...stateIssues];
    return receipt;
  }

  return executePlan(path.resolve(rootDir), sourceRel, plan, options);
}

export async function writeAgentApplyReport(
  rootDir: string,
  report: AgentApplyReport,
): Promise<{ path: string; report: AgentApplyReport }> {
  const outPath = path.join(rootDir, APPLY_REPORT_PATH);
  await writeJson(outPath, report);
  return { path: outPath, report };
}
