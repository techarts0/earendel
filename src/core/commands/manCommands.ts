import { Command } from '../types';
import { manDatabase } from '../manDatabase';
import { globalTutorEngine } from '../tutorEngine';

export const manCommands: Command[] = [
  {
    name: 'man',
    description: 'An interface to the system reference manuals & AI Living MAN Agent (man agent on/off)',
    category: 'sys',
    execute: (ctx) => {
      const targetCmd = ctx.args[0];

      // Handle 'man agent on/off/status/explain'
      if (targetCmd === 'agent' || targetCmd === '-ai' || targetCmd === '--ai') {
        const sub = ctx.args[1];
        if (sub === 'on' || sub === 'enable' || sub === 'start') {
          globalTutorEngine.setEnabled(true);
          const llm = globalTutorEngine.checkLLMConfig(ctx.vfs);
          let msg = `\x1b[1;35m[MAN Agent: AI Tutor]\x1b[0m \x1b[1;32mEnabled successfully!\x1b[0m\nWhen command errors or invalid options occur, the AI Tutor will provide real-time diagnosis, syntax corrections, and concept guidance.\n\n`;

          if (!llm.configured) {
            msg += `\x1b[33m⚠️  [Warning: /etc/llm.conf is unconfigured or missing a valid API_KEY]\x1b[0m\n` +
              `   • Status: Running in \x1b[1mBuilt-in Offline Mode\x1b[0m (local POSIX heuristic rules)\n` +
              `   • Action: To enable live cloud LLM reasoning, configure /etc/llm.conf:\n` +
              `             \x1b[1;32mvi /etc/llm.conf\x1b[0m (specify API_KEY, BASE_URL, MODEL_NAME)\n\n`;
          } else {
            msg += `\x1b[32m✔ Cloud LLM Active:\x1b[0m Connected to ${llm.provider} (${llm.model}) via /etc/llm.conf\n\n`;
          }

          msg += `Type \x1b[33mman agent off\x1b[0m anytime to restore standard terminal mode.\n`;
          return { stdout: msg, stderr: '', exitCode: 0 };
        }

        if (sub === 'off' || sub === 'disable' || sub === 'stop') {
          globalTutorEngine.setEnabled(false);
          return {
            stdout: `\x1b[1;35m[MAN Agent: AI Tutor]\x1b[0m \x1b[1;33mDisabled.\x1b[0m Terminal restored to standard mode.\n`,
            stderr: '',
            exitCode: 0,
          };
        }

        if (sub === 'status') {
          const llm = globalTutorEngine.checkLLMConfig(ctx.vfs);
          const statusStr = globalTutorEngine.isEnabled()
            ? '\x1b[1;32m● ACTIVE (RUNNING)\x1b[0m'
            : '\x1b[90m○ INACTIVE (OFF)\x1b[0m';
          const backendStr = llm.configured
            ? `\x1b[1;32mCloud LLM Provider (${llm.provider} / ${llm.model})\x1b[0m`
            : `\x1b[33mBuilt-in Offline Heuristics (/etc/llm.conf unconfigured)\x1b[0m`;
          const keyStatusStr = llm.hasKey
            ? '\x1b[32mValid Key Loaded\x1b[0m'
            : '\x1b[31mUnset or Placeholder (sk-your-api-key-here)\x1b[0m';

          let out = `\x1b[1;35m[MAN Agent: AI Tutor Status]\x1b[0m\n` +
            `  Service State:   ${statusStr}\n` +
            `  Inference Mode:  ${backendStr}\n` +
            `  Config File:     /etc/llm.conf (Base URL: ${llm.baseUrl})\n` +
            `  API Key Status:  ${keyStatusStr}\n`;

          if (!llm.configured) {
            out += `\n\x1b[33m💡 Setup Tip:\x1b[0m Run '\x1b[1;32mvi /etc/llm.conf\x1b[0m' to set your API_KEY for live cloud LLM reasoning.\n`;
          }

          out += `\nCommands:\n  man agent on     Enable tutor\n  man agent off    Disable tutor\n  man agent <cmd>  Interactive manual guide\n`;
          return { stdout: out, stderr: '', exitCode: 0 };
        }

        const explainTarget = sub === 'explain' ? ctx.args[2] : sub;
        if (explainTarget) {
          return {
            stdout: globalTutorEngine.explainCommand(explainTarget),
            stderr: '',
            exitCode: 0,
          };
        }

        return {
          stdout: `\x1b[1;35m[MAN Agent: Living Manual & Real-time AI Assistant]\x1b[0m\nUsage:\n  man agent on           Enable error diagnosis & pedagogical tutor\n  man agent off          Disable AI tutor and restore standard terminal\n  man agent status       Check current AI tutor status\n  man agent <command>    Invoke AI interactive walkthrough and examples for a command\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      if (!targetCmd) {
        return { stdout: '', stderr: 'What manual page do you want?\nFor example, try \'man ls\' or \'man agent on\'.\n', exitCode: 1 };
      }

      const page = manDatabase[targetCmd];
      if (!page) {
        // If static page not found, check if tutor engine can explain it
        if (globalTutorEngine.isEnabled()) {
          return { stdout: globalTutorEngine.explainCommand(targetCmd), stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: `No manual entry for ${targetCmd}\n`, exitCode: 1 };
      }

      const isZh = ctx.lang === 'zh';
      const desc = isZh ? page.descriptionZh : page.descriptionEn;
      const opts = isZh ? page.optionsZh : page.optionsEn;
      const examples = isZh ? page.examplesZh : page.examplesEn;

      const header = `\x1b[1m${page.name.toUpperCase()}(${page.section})             System General Commands Manual             ${page.name.toUpperCase()}(${page.section})\x1b[0m\n\n`;

      let body = `\x1b[1;36mNAME\x1b[0m\n       ${page.name} - ${desc}\n\n`;
      body += `\x1b[1;36mSYNOPSIS\x1b[0m\n       \x1b[1m${page.synopsis}\x1b[0m\n\n`;

      body += `\x1b[1;36mDESCRIPTION\x1b[0m\n       ${desc}\n\n`;

      if (opts && opts.length > 0) {
        body += `\x1b[1;36mOPTIONS\x1b[0m\n`;
        opts.forEach((o) => {
          body += `       \x1b[1;33m${o.opt.padEnd(20)}\x1b[0m\n              ${o.desc}\n`;
        });
        body += '\n';
      }

      if (examples && examples.length > 0) {
        body += `\x1b[1;36mEXAMPLES\x1b[0m\n`;
        examples.forEach((ex) => {
          body += `       $ \x1b[32m${ex}\x1b[0m\n`;
        });
        body += '\n';
      }

      const footer = `\x1b[90mEarendel Manual Page v1.0 (${isZh ? '中文说明' : 'English Manual'})              ${new Date().toLocaleDateString()}\x1b[0m\n`;

      return { stdout: header + body + footer, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tutor',
    description: 'AI Living Manual and Real-time Teaching Assistant (shortcut for man agent)',
    category: 'sys',
    execute: (ctx) => {
      // Forward to man agent
      const manCmd = manCommands.find((c) => c.name === 'man')!;
      return manCmd.execute({ ...ctx, args: ['agent', ...ctx.args] });
    },
  },
];

