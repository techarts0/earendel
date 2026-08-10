// Earendel POSIX Standard System Library (eslib.js - Earendel Sys Lib)
import { globalVFS } from '../../core/vfs';

export const ESLIB_SOURCE_CODE = `// Earendel System Library (eslib.js v1.0.0)
// POSIX C/JS Runtime System Library Bindings for Earendel Microkernel

(function(global) {
  const eslib = {
    sys: {
      open: function(path, flags) {
        return global.syscall ? global.syscall(2, path, flags || 'r') : null;
      },
      close: function(fd) {
        return global.syscall ? global.syscall(3, fd) : null;
      },
      read: function(target, count) {
        return global.syscall ? global.syscall(0, target, count) : null;
      },
      write: function(target, content) {
        return global.syscall ? global.syscall(1, target, content) : null;
      },
      lseek: function(fd, offset, whence) {
        return global.syscall ? global.syscall(8, fd, offset || 0, whence || 0) : null;
      },
      fork: function(name, cwd) {
        return global.syscall ? global.syscall(57, name || 'child_proc', cwd || '/home/hello') : null;
      },
      execve: function(path, args) {
        return global.syscall ? global.syscall(59, path, args) : null;
      },
      exit: function(code) {
        return global.syscall ? global.syscall(60, code || 0) : null;
      },
      getpid: function() {
        return global.syscall ? global.syscall(39) : null;
      }
    },
    io: {
      printf: function(fmt, ...args) {
        let str = String(fmt);
        args.forEach(a => { str = str.replace('%s', String(a)).replace('%d', String(a)); });
        if (typeof console !== 'undefined' && console.log) {
          console.log(str);
        }
        return str;
      }
    },
    mem: {
      malloc: function(sizeBytes) {
        return { ptr: Math.floor(Math.random() * 0x100000), size: sizeBytes };
      }
    }
  };

  global.eslib = eslib;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = eslib;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

export function initESLibSystemFile() {
  try {
    if (!globalVFS.getNodeByPath('/lib')) {
      globalVFS.mkdir('/lib', true);
    }
    globalVFS.writeFile('/lib/eslib.js', ESLIB_SOURCE_CODE);
  } catch (e) {}
}

// Auto init on module import
initESLibSystemFile();
