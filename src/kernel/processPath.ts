const MAX_PROCESS_PATH_CHARS = 4096;

/** Resolve a path against one PCB's cwd/home without consulting shared VFS state. */
export function resolveProcessPath(path: unknown, cwd: string, home: string): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PROCESS_PATH_CHARS || path.includes('\0')) {
    return null;
  }
  const processCwd = cwd.startsWith('/') ? cwd : '/';
  const processHome = home.startsWith('/') ? home : '/';
  let requested = path;
  if (requested === '~') requested = processHome;
  else if (requested.startsWith('~/')) requested = `${processHome}/${requested.slice(2)}`;
  const absolutePath = requested.startsWith('/') ? requested : `${processCwd}/${requested}`;
  // Keep '..' until the VFS resolves symlinks. Lexically collapsing
  // `link/..` first changes POSIX traversal and capability semantics.
  const parts = absolutePath.split('/').filter((part) => part && part !== '.');
  return `/${parts.join('/')}`;
}
