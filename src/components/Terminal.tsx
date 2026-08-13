import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ShellEngine } from '../core/shellEngine';
import { globalVFS } from '../core/vfs';
import { globalProcessManager } from '../core/processManager';
import { globalCommandRegistry } from '../core/commandRegistry';
import { registerAllCommands } from '../core/commands';
import { Language } from '../i18n/translations';
import { globalSoundEngine } from '../core/soundEngine';
import { globalThemeManager, THEME_PRESETS } from '../core/themeManager';
import { highlightCommandLine } from '../core/syntaxHighlighter';

interface TerminalProps {
  onOpenNano?: (opts: { path: string; content: string }) => void;
  onOpenVi?: (opts: { path: string; content: string }) => void;
  onOpenHarnessTui?: (opts: { path: string; content: string }) => void;
  onOpenCheat?: () => void;
  onSplitTmux?: (type: 'v' | 'h' | 'exit') => void;
  skipBootScreen?: boolean;
}

export const Terminal: React.FC<TerminalProps> = ({ onOpenNano, onOpenVi, onOpenHarnessTui, onOpenCheat, onSplitTmux, skipBootScreen }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef<string>('');
  const [lang, setLang] = useState<Language>('en');

  const shellEngineRef = useRef<ShellEngine>(new ShellEngine(globalVFS, globalProcessManager));
  const pendingLoginUserRef = useRef<string | null>(null);
  const isInitialBootLoginRef = useRef<boolean>(true);
  const pendingSudoCmdRef = useRef<{ username: string; commandLine: string } | null>(null);
  const historyIndexRef = useRef<number>(-1);

  const promptStr = () => {
    const pwd = globalVFS.getPwd();
    const user = shellEngineRef.current.getEnv('USER') || 'hello';
    const home = shellEngineRef.current.getEnv('HOME') || '/home/hello';
    let shortPwd = pwd;

    if (pwd === home) {
      shortPwd = '~';
    } else if (pwd.startsWith(home + '/')) {
      shortPwd = '~' + pwd.slice(home.length);
    }

    const isRoot = user === 'root';
    const symbol = isRoot ? '#' : '$';
    const userColor = isRoot ? '\x1b[1;31m' : '\x1b[1;32m';

    return `${userColor}${user}@earendel\x1b[0m:\x1b[1;34m${shortPwd}\x1b[0m${symbol} `;
  };

  useEffect(() => {
    shellEngineRef.current.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Dynamic Terminal Theme Configuration
    const term = new XTerminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'Fira Code', 'Courier New', monospace",
      fontSize: 15,
      lineHeight: 1.25,
      allowTransparency: true,
      theme: globalThemeManager.getCurrentTheme(),
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const safeFit = () => {
      try {
        if (terminalRef.current && terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0) {
          fitAddon.fit();
        }
      } catch (err) {
        // Safe catch
      }
    };

    const timer = setTimeout(() => {
      safeFit();
      // Ensure all executable binary symbols are synchronized under /usr/bin/
      registerAllCommands();
      globalCommandRegistry.syncAllSymbolsToVFS();
    }, 100);

    const showUbuntuWelcome = () => {
      globalSoundEngine.playLoginSound();
      term.reset();
      term.writeln('\x1b[1;36mWelcome to Earendel\x1b[0m');
      term.writeln('\x1b[90mType \x1b[33mhelp\x1b[90m for commands, \x1b[33mlang zh\x1b[90m for Chinese.\x1b[0m\n');
      term.write(promptStr());
    };

    if (skipBootScreen) {
      isInitialBootLoginRef.current = false;
      showUbuntuWelcome();
    } else {
      term.writeln('\x1b[1;36mEarendel: An AI Native Microkernel OS on V8\x1b[0m');
      term.writeln('\x1b[90mhttps://github.com/techarts0/earendel\x1b[0m');
      term.writeln('\x1b[90mDefault users: \x1b[33mhello or root\x1b[90m, password: \x1b[33m123456\x1b[0m\n');
      term.write('earendel login: ');
    }

    const disposable = term.onData(async (key) => {
      // Hotkey Ctrl+Shift+C (Copy)
      if (key === '\x03' && term.hasSelection()) {
        const selectedText = term.getSelection();
        if (selectedText && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(selectedText);
        }
        return;
      }

      // Hotkey Ctrl+Shift+V (Paste)
      if (key === '\x16') {
        if (navigator.clipboard && navigator.clipboard.readText) {
          try {
            const clipText = await navigator.clipboard.readText();
            if (clipText) {
              inputBufferRef.current += clipText;
              term.write(clipText);
            }
          } catch (e) { }
        }
        return;
      }

      if (key === '\r' || key === '\n') {
        globalSoundEngine.playEnterSound();
        historyIndexRef.current = -1;
        term.writeln('');
        const cmd = inputBufferRef.current.trim();
        inputBufferRef.current = '';

        // Initial boot login step 1: enter username
        if (isInitialBootLoginRef.current && !pendingLoginUserRef.current) {
          const loginUser = cmd || 'hello';
          pendingLoginUserRef.current = loginUser;
          term.write('Password: ');
          return;
        }

        // Sudo password verification
        if (pendingSudoCmdRef.current) {
          const { username, commandLine } = pendingSudoCmdRef.current;
          pendingSudoCmdRef.current = null;
          const enteredPassword = cmd;

          const shadowContent = globalVFS.readFile('/etc/shadow') ?? '';
          const userShadowLine = shadowContent.split('\n').find((l) => l.startsWith(`${username}:`));
          const expectedPass = userShadowLine ? userShadowLine.split(':')[1] : '123456';

          if (enteredPassword !== expectedPass && enteredPassword !== '123456') {
            term.writeln('\x1b[31msudo: 1 incorrect password attempt\x1b[0m\r\n');
            term.write(promptStr());
            return;
          }

          // Elevate temporarily to root to run command
          const prevUser = shellEngineRef.current.getEnv('USER');
          shellEngineRef.current.setEnv('USER', 'root');
          const res = await shellEngineRef.current.execute(commandLine);
          shellEngineRef.current.setEnv('USER', prevUser);

          if (res.stdout) term.write(res.stdout.replace(/\n/g, '\r\n'));
          if (res.stderr) term.write(`\x1b[31m${res.stderr.replace(/\n/g, '\r\n')}\x1b[0m`);
          term.write(promptStr());
          return;
        }

        // Standard Login password verification
        if (pendingLoginUserRef.current) {
          const targetUser = pendingLoginUserRef.current;
          pendingLoginUserRef.current = null;
          const enteredPassword = cmd;

          const shadowContent = globalVFS.readFile('/etc/shadow') ?? '';
          const userShadowLine = shadowContent.split('\n').find((l) => l.startsWith(`${targetUser}:`));
          const expectedPass = userShadowLine ? userShadowLine.split(':')[1] : '123456';
          const isPassValid = enteredPassword === '123456' || enteredPassword === expectedPass || (enteredPassword === '123456' && expectedPass.startsWith('$6$'));

          if (!isPassValid) {
            term.writeln('\x1b[31mLogin incorrect\x1b[0m\r\n');
            if (isInitialBootLoginRef.current) {
              term.write('earendel login: ');
            } else {
              term.write(promptStr());
            }
            return;
          }

          shellEngineRef.current.setEnv('USER', targetUser);
          const home = targetUser === 'root' ? '/root' : `/home/${targetUser}`;
          shellEngineRef.current.setEnv('HOME', home);
          globalVFS.mkdir(home, true);
          globalVFS.changeDirectory(home);

          if (isInitialBootLoginRef.current) {
            isInitialBootLoginRef.current = false;
            showUbuntuWelcome();
          } else {
            term.reset();
            term.writeln(`\x1b[1;32mLast login: ${new Date().toUTCString()} on tty1\x1b[0m\r\n`);
            term.write(promptStr());
          }
          return;
        }

        if (cmd) {
          if (cmd === 'lang zh' || cmd === 'lang en') {
            const targetLang = cmd === 'lang zh' ? 'zh' : 'en';
            setLang(targetLang);
            shellEngineRef.current.lang = targetLang;
            term.writeln(`Language set to ${targetLang === 'zh' ? '中文' : 'English'}.\r\n`);
          } else {
            const res = await shellEngineRef.current.execute(cmd);
            if (res.stdout) {
              term.write(res.stdout.replace(/\n/g, '\r\n'));
            }
            if (res.stderr) {
              term.write(`\x1b[31m${res.stderr.replace(/\n/g, '\r\n')}\x1b[0m`);
            }

            if (res.poweroff) {
              setTimeout(() => {
                try {
                  window.close();
                } catch (e) { }
                term.clear();
                term.writeln('\x1b[31m[ System halted. Power down. ]\x1b[0m\r\n');
              }, 1200);
              return;
            }

            if (res.reboot) {
              setTimeout(() => {
                window.location.reload();
              }, 1200);
              return;
            }

            if (res.logout) {
              shellEngineRef.current.setEnv('USER', 'hello');
              shellEngineRef.current.setEnv('HOME', '/home/hello');
              globalVFS.changeDirectory('/home/hello');
              isInitialBootLoginRef.current = true;
              term.reset();
              term.writeln('\x1b[1;36mEarendel: An AI Native Microkernel OS on V8\x1b[0m');
              term.writeln('\x1b[90mhttps://github.com/techarts0/earendel\x1b[0m');
              term.writeln('\x1b[90mDefault users: \x1b[33mhello or root\x1b[90m, password: \x1b[33m123456\x1b[0m\n');
              term.write('earendel login: ');
              return;
            }

            if (res.openNano && onOpenNano) {
              onOpenNano(res.openNano);
            }

            if (res.openVi && onOpenVi) {
              onOpenVi(res.openVi);
            }

            if (res.openHarnessTui && onOpenHarnessTui) {
              onOpenHarnessTui(res.openHarnessTui);
            }

            if (res.openCheat && onOpenCheat) {
              onOpenCheat();
            }

            if (res.toggleFullscreen) {
              if (res.toggleFullscreen === 'max') {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen().catch(() => { });
                }
              } else if (res.toggleFullscreen === 'restore') {
                if (document.fullscreenElement) {
                  document.exitFullscreen().catch(() => { });
                }
              }
              setTimeout(() => {
                safeFit();
              }, 100);
            }

            if (res.splitTmux && onSplitTmux) {
              onSplitTmux(res.splitTmux);
            }

            if (res.loginPrompt) {
              pendingLoginUserRef.current = res.loginPrompt.username;
              inputBufferRef.current = '';
              term.write(`Password: `);
              return;
            }

            if (res.sudoPrompt) {
              pendingSudoCmdRef.current = res.sudoPrompt;
              inputBufferRef.current = '';
              term.write(`[sudo] password for ${res.sudoPrompt.username}: `);
              return;
            }
          }
        }

        term.write(promptStr());
      } else if (key === '\x7f' || key === '\b') {
        globalSoundEngine.playBackspaceSound();
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          if (!pendingLoginUserRef.current && !pendingSudoCmdRef.current) {
            term.write('\b \b');
          }
        }
      } else if (key === '\x03') {
        inputBufferRef.current = '';
        pendingLoginUserRef.current = null;
        pendingSudoCmdRef.current = null;
        term.writeln('^C');
        if (isInitialBootLoginRef.current) {
          term.write('earendel login: ');
        } else {
          term.write(promptStr());
        }
      } else if (key === '\x0c') {
        term.clear();
        if (isInitialBootLoginRef.current) {
          term.write('earendel login: ');
        } else {
          term.write(promptStr());
        }
      } else if (key === '\x1b[A') {
        // Up Arrow Key
        const history = shellEngineRef.current.getHistory();
        if (history.length === 0) return;

        if (historyIndexRef.current === -1) {
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        }

        const selectedCmd = history[historyIndexRef.current] || '';
        // Clear current printed line
        while (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          term.write('\b \b');
        }
        inputBufferRef.current = selectedCmd;
        term.write(highlightCommandLine(selectedCmd));
      } else if (key === '\x1b[B') {
        // Down Arrow Key
        const history = shellEngineRef.current.getHistory();
        if (historyIndexRef.current !== -1) {
          historyIndexRef.current++;
          let selectedCmd = '';
          if (historyIndexRef.current >= history.length) {
            historyIndexRef.current = -1;
            selectedCmd = '';
          } else {
            selectedCmd = history[historyIndexRef.current] || '';
          }

          // Clear current printed line
          while (inputBufferRef.current.length > 0) {
            inputBufferRef.current = inputBufferRef.current.slice(0, -1);
            term.write('\b \b');
          }
          inputBufferRef.current = selectedCmd;
          term.write(highlightCommandLine(selectedCmd));
        }
      } else if (key === '\t') {
        const line = inputBufferRef.current;
        const parts = line.split(/\s+/);

        // 1. Command Name Tab Completion
        if (parts.length === 1) {
          const prefix = parts[0];
          const allCmds = globalCommandRegistry.getAllCommands();
          const cmdNames = new Set<string>();
          allCmds.forEach((c) => {
            cmdNames.add(c.name);
            c.aliases?.forEach((a) => cmdNames.add(a));
          });

          const matches = Array.from(cmdNames).filter((n) => n.startsWith(prefix));
          if (matches.length === 1) {
            const completion = matches[0].slice(prefix.length) + ' ';
            inputBufferRef.current += completion;
            term.write(completion);
          } else if (matches.length > 1) {
            term.writeln('\r\n' + matches.join('  '));
            term.write(promptStr() + inputBufferRef.current);
          }
        } else {
          // 2. Path & File Tab Completion
          const lastArg = parts[parts.length - 1] || '';
          let searchDir = '.';
          let prefix = lastArg;

          if (lastArg.includes('/')) {
            const lastSlash = lastArg.lastIndexOf('/');
            searchDir = lastArg.substring(0, lastSlash) || '/';
            prefix = lastArg.substring(lastSlash + 1);
          }

          const dirNode = globalVFS.getNodeByPath(searchDir);
          if (dirNode && dirNode.children) {
            const matches: { name: string; isDir: boolean }[] = [];
            for (const [name, child] of dirNode.children.entries()) {
              if (name.startsWith(prefix)) {
                matches.push({ name, isDir: child.type === 'directory' });
              }
            }

            if (matches.length === 1) {
              const match = matches[0];
              const suffix = match.isDir ? '/' : ' ';
              const completion = match.name.slice(prefix.length) + suffix;
              inputBufferRef.current += completion;
              term.write(completion);
            } else if (matches.length > 1) {
              const names = matches.map((m) => m.name + (m.isDir ? '/' : ''));
              term.writeln('\r\n' + names.join('  '));
              term.write(promptStr() + inputBufferRef.current);
            }
          }
        }
      } else if (key >= ' ' && key <= '~') {
        globalSoundEngine.playKeySound();
        inputBufferRef.current += key;
        if (!pendingLoginUserRef.current) {
          term.write(key);
        }
      }
    });

    const handleResize = () => {
      safeFit();
    };

    const handleThemeChange = (e: Event) => {
      const themeName = (e as CustomEvent).detail;
      if (THEME_PRESETS[themeName]) {
        term.options.theme = THEME_PRESETS[themeName].theme;
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('earendel:theme-changed', handleThemeChange);

    return () => {
      clearTimeout(timer);
      disposable.dispose();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('earendel:theme-changed', handleThemeChange);
      term.dispose();
    };
  }, []);

  return (
    <div className="w-full h-full p-0 overflow-hidden bg-transparent">
      <div ref={terminalRef} className="w-full h-full" />
    </div>
  );
};
