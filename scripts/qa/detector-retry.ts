import { closeLoop } from "../../packages/skills/src/loop-closure/index.ts";

// For stack-trace: needs absolute path pattern
const stackOut = closeLoop({
  stdout: "Error: boom\n    at foo (/home/user/src/bar.ts:12:5)\n    at baz (/home/user/src/qux.ts:34:7)\n",
  stderr: "",
  exitCode: 1,
});
console.log("stack-trace test (absolute unix path):", JSON.stringify({
  reason: stackOut.stallReason,
  kinds: stackOut.evidence.map((e) => e.kind),
}));

// For stack-trace: Windows path
const stackOutWin = closeLoop({
  stdout: "Error: boom\n    at foo (C:\\Users\\x\\src\\bar.ts:12:5)\n    at baz (C:\\Users\\x\\src\\qux.ts:34:7)\n",
  stderr: "",
  exitCode: 1,
});
console.log("stack-trace test (windows path):", JSON.stringify({
  reason: stackOutWin.stallReason,
  kinds: stackOutWin.evidence.map((e) => e.kind),
}));

// incomplete-function: empty body
const incompleteOut = closeLoop({
  stdout: "export function foo() {}",
  stderr: "",
  exitCode: 0,
});
console.log("incomplete-function test (no space body):", JSON.stringify({
  reason: incompleteOut.stallReason,
  kinds: incompleteOut.evidence.map((e) => e.kind),
}));

// incomplete-function: "function x() { }" with space
const incomplete2 = closeLoop({
  stdout: "function thing() {  }",
  stderr: "",
  exitCode: 0,
});
console.log("incomplete-function test (space body):", JSON.stringify({
  reason: incomplete2.stallReason,
  kinds: incomplete2.evidence.map((e) => e.kind),
}));
