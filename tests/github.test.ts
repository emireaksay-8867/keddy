import { describe, it, expect } from "vitest";
import {
  parseGitRemote,
  commitUrl,
  branchUrl,
  fileUrl,
  prUrl,
} from "../src/capture/github.js";

describe("parseGitRemote", () => {
  it("should parse SSH remote URLs", () => {
    const result = parseGitRemote("git@github.com:owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("should parse SSH URLs without .git suffix", () => {
    const result = parseGitRemote("git@github.com:owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("should parse HTTPS remote URLs", () => {
    const result = parseGitRemote("https://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("should parse HTTPS URLs without .git suffix", () => {
    const result = parseGitRemote("https://github.com/owner/repo");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("should parse HTTP URLs", () => {
    const result = parseGitRemote("http://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("should handle complex owner/repo names", () => {
    const result = parseGitRemote("git@github.com:my-org/my-repo-name.git");
    expect(result).toEqual({ owner: "my-org", repo: "my-repo-name" });
  });

  it("should return null for non-GitHub URLs", () => {
    expect(parseGitRemote("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(parseGitRemote("https://bitbucket.org/owner/repo")).toBeNull();
    expect(parseGitRemote("not-a-url")).toBeNull();
  });
});

describe("URL construction", () => {
  const repo = { owner: "emireaksay-8867", repo: "keddy" };

  it("should construct commit URLs", () => {
    expect(commitUrl(repo, "abc123")).toBe(
      "https://github.com/emireaksay-8867/keddy/commit/abc123",
    );
  });

  it("should construct branch URLs", () => {
    expect(branchUrl(repo, "main")).toBe(
      "https://github.com/emireaksay-8867/keddy/tree/main",
    );
  });

  it("should construct file URLs", () => {
    expect(fileUrl(repo, "src/index.ts")).toBe(
      "https://github.com/emireaksay-8867/keddy/blob/main/src/index.ts",
    );
  });

  it("should construct file URLs with custom branch", () => {
    expect(fileUrl(repo, "src/index.ts", "develop")).toBe(
      "https://github.com/emireaksay-8867/keddy/blob/develop/src/index.ts",
    );
  });

  it("should construct PR URLs", () => {
    expect(prUrl(repo, 42)).toBe(
      "https://github.com/emireaksay-8867/keddy/pull/42",
    );
  });
});
