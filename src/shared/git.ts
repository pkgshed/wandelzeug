/**
 * Running git, and turning a git remote into the web address of its
 * repository.
 */

/** Runs git in a directory and returns its standard output. */
export async function runGit(
  directory: string,
  args: readonly string[],
): Promise<string> {
  const child = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status !== 0) {
    const reason = stderr.trim() || `exit status ${status}`;
    throw new Error(`git ${args.join(" ")}: ${reason}`);
  }
  return stdout;
}

/**
 * Reads the URL of the origin remote as the configuration spells it, or
 * returns undefined without git, a repository or an origin remote. It reads
 * the raw setting because "git remote get-url" applies insteadOf rewrites,
 * which often point at private SSH host aliases.
 */
export async function readOriginUrl(
  directory: string,
): Promise<string | undefined> {
  try {
    const url = await runGit(directory, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    return url.trim() === "" ? undefined : url.trim();
  } catch {
    return undefined;
  }
}

/** The SCP-like form of SSH remotes, such as git@codeberg.org:owner/repo.git. */
const SCP_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/;

const WEB_PROTOCOLS = ["https:", "http:", "ssh:", "git:", "git+ssh:"];

function remoteHostAndPath(remote: string): [string, string] | undefined {
  const scp = SCP_REMOTE.exec(remote);
  if (scp !== null) return [scp[1] ?? "", scp[2] ?? ""];
  if (!URL.canParse(remote)) return undefined;

  const url = new URL(remote);
  if (!WEB_PROTOCOLS.includes(url.protocol)) return undefined;
  return [url.hostname, url.pathname];
}

/**
 * Turns a git remote into the https address of its repository, such as
 * https://codeberg.org/owner/repo. It drops user names, credentials, ports
 * and a ".git" suffix, and returns undefined for remotes without a host,
 * such as local paths.
 */
export function webUrlOfRemote(remote: string): string | undefined {
  const parts = remoteHostAndPath(remote.trim());
  if (parts === undefined) return undefined;

  const [host, rawPath] = parts;
  const path = rawPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
  const hasOwnerAndName = path.includes("/");
  if (host === "" || !hasOwnerAndName) return undefined;
  return `https://${host}/${path}`;
}
