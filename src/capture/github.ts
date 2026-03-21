export interface GitHubRepo {
  owner: string;
  repo: string;
}

const SSH_RE = /git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/;
const HTTPS_RE = /https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/;

export function parseGitRemote(url: string): GitHubRepo | null {
  const sshMatch = url.match(SSH_RE);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const httpsMatch = url.match(HTTPS_RE);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  return null;
}

export function commitUrl(repo: GitHubRepo, sha: string): string {
  return `https://github.com/${repo.owner}/${repo.repo}/commit/${sha}`;
}

export function branchUrl(repo: GitHubRepo, branch: string): string {
  return `https://github.com/${repo.owner}/${repo.repo}/tree/${branch}`;
}

export function fileUrl(repo: GitHubRepo, filePath: string, branch: string = "main"): string {
  return `https://github.com/${repo.owner}/${repo.repo}/blob/${branch}/${filePath}`;
}

export function prUrl(repo: GitHubRepo, prNumber: number): string {
  return `https://github.com/${repo.owner}/${repo.repo}/pull/${prNumber}`;
}
