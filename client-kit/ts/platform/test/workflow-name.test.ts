import { describe, expect, it } from "vitest";
import { generateWorkflowName, workflowNameWordCount } from "../src/react/workflow-name";

describe("original generate_passphrase(3, \"-\") workflow names", () => {
  it("carries the full EFF short wordlist 2.0", () => {
    expect(workflowNameWordCount).toBe(1296);
  });

  it("joins three unbiased draws and rejects values at or above 64800", () => {
    const draws = [64800, 0, 65535, 1, 1295];
    const name = generateWorkflowName((buffer) => { buffer[0] = draws.shift()!; return buffer; });
    expect(name).toBe("aardvark-abandoned-zucchini");
  });

  it("keeps the original 12-character minimum", () => {
    for (let index = 0; index < 50; index += 1) expect(generateWorkflowName()!.length).toBeGreaterThanOrEqual(12);
  });

  it("returns no name when entropy is unavailable", () => {
    expect(generateWorkflowName(() => { throw new Error("no entropy"); })).toBeNull();
  });
});
