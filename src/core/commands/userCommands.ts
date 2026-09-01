// Behavioral User & Permission Management Commands for Earendel
import { Command } from '../types';

export const userCommands: Command[] = [
  {
    name: 'chown',
    description: 'Change file owner and group (supports OWNER:GROUP, -R, -v, -c, -f)',
    category: 'file',
    execute: (ctx) => {
      const flags = new Set<string>();
      let ownerGroup: string | null = null;
      const targets: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else if (!ownerGroup) {
          ownerGroup = arg;
        } else {
          targets.push(arg);
        }
      }

      if (!ownerGroup || targets.length === 0) {
        return { stdout: '', stderr: 'chown: missing operand\nUsage: chown [-R] OWNER[:GROUP] FILE...\n', exitCode: 1 };
      }

      const recursive = flags.has('R') || flags.has('r') || flags.has('recursive');
      const verbose = flags.has('v') || flags.has('verbose');
      const changesOnly = flags.has('c') || flags.has('changes');
      const silent = flags.has('f') || flags.has('silent') || flags.has('quiet');

      let totalStdout = '';
      let totalStderr = '';
      let exitCode = 0;

      for (const target of targets) {
        const node = ctx.vfs.getNodeByPath(target);
        if (!node) {
          if (!silent) {
            totalStderr += `chown: cannot access '${target}': No such file or directory\n`;
          }
          exitCode = 1;
          continue;
        }

        const oldOwnerGroup = `${node.owner}:${node.group}`;
        const ok = ctx.vfs.chown(target, ownerGroup, recursive);
        if (!ok) {
          if (!silent) {
            totalStderr += `chown: changing ownership of '${target}': Operation not permitted\n`;
          }
          exitCode = 1;
        } else {
          const newOwnerGroup = `${node.owner}:${node.group}`;
          if (verbose) {
            totalStdout += `ownership of '${target}' retained as ${newOwnerGroup}\n`;
          } else if (changesOnly && oldOwnerGroup !== newOwnerGroup) {
            totalStdout += `changed ownership of '${target}' from ${oldOwnerGroup} to ${newOwnerGroup}\n`;
          }
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'useradd',
    description: 'Create a new user (-m, -s, -d, -g, -G, -u)',
    category: 'sys',
    execute: (ctx) => {
      let createHome = false;
      let shell = '/bin/bash';
      let homeDir: string | null = null;
      let customUid: number | null = null;
      let primaryGroup: string | null = null;
      let username: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-m' || arg === '--create-home') {
          createHome = true;
        } else if (arg === '-s' && ctx.args[i + 1]) {
          shell = ctx.args[i + 1];
          i++;
        } else if (arg === '-d' && ctx.args[i + 1]) {
          homeDir = ctx.args[i + 1];
          i++;
        } else if (arg === '-u' && ctx.args[i + 1]) {
          customUid = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg === '-g' && ctx.args[i + 1]) {
          primaryGroup = ctx.args[i + 1];
          i++;
        } else if (!arg.startsWith('-')) {
          username = arg;
        }
      }

      if (!username) return { stdout: '', stderr: 'useradd: missing username\nUsage: useradd [options] LOGIN\n', exitCode: 1 };

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      if (passwdContent.includes(`${username}:`)) {
        return { stdout: '', stderr: `useradd: user '${username}' already exists\n`, exitCode: 9 };
      }

      const existingUids = passwdContent
        .split('\n')
        .map((l) => parseInt(l.split(':')[2], 10))
        .filter((u) => !isNaN(u));
      const uid = customUid !== null && !isNaN(customUid) ? customUid : (existingUids.length > 0 ? Math.max(...existingUids, 999) + 1 : 1000);
      const userHome = homeDir || `/home/${username}`;

      const newPasswdLine = `${username}:x:${uid}:${uid}:${username}:${userHome}:${shell}\n`;
      ctx.vfs.writeFile('/etc/passwd', passwdContent + (passwdContent.endsWith('\n') ? '' : '\n') + newPasswdLine);

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      ctx.vfs.writeFile('/etc/shadow', shadowContent + (shadowContent.endsWith('\n') ? '' : '\n') + `${username}:${username}:19000:0:99999:7:::\n`);

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      if (!groupContent.includes(`${username}:`)) {
        ctx.vfs.writeFile('/etc/group', groupContent + (groupContent.endsWith('\n') ? '' : '\n') + `${username}:x:${uid}:\n`);
      }

      if (createHome || !homeDir) {
        ctx.vfs.mkdir(userHome, true);
        ctx.vfs.chown(userHome, `${username}:${username}`, true);
        ctx.vfs.chmod(userHome, '755');
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'userdel',
    description: 'Delete a user account and related files (-r, -f)',
    category: 'sys',
    execute: (ctx) => {
      let removeHome = false;
      let username: string | null = null;

      for (const arg of ctx.args) {
        if (arg === '-r' || arg === '--remove') {
          removeHome = true;
        } else if (!arg.startsWith('-')) {
          username = arg;
        }
      }

      if (!username) return { stdout: '', stderr: 'userdel: missing username\nUsage: userdel [-r] LOGIN\n', exitCode: 1 };

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      if (!passwdContent.includes(`${username}:`)) {
        return { stdout: '', stderr: `userdel: user '${username}' does not exist\n`, exitCode: 6 };
      }

      const lines = passwdContent.split('\n').filter((l) => !l.startsWith(`${username}:`));
      ctx.vfs.writeFile('/etc/passwd', lines.join('\n'));

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      const sLines = shadowContent.split('\n').filter((l) => !l.startsWith(`${username}:`));
      ctx.vfs.writeFile('/etc/shadow', sLines.join('\n'));

      if (removeHome) {
        ctx.vfs.remove(`/home/${username}`, true);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'su',
    description: 'Change user ID or become superuser (supports su -, su <user>, -c <cmd>)',
    category: 'sys',
    execute: async (ctx) => {
      let isLoginEnv = false;
      let commandToRun: string | null = null;
      let targetUser = 'root';

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-' || arg === '-l' || arg === '--login') {
          isLoginEnv = true;
        } else if (arg === '-c' && ctx.args[i + 1]) {
          commandToRun = ctx.args.slice(i + 1).join(' ');
          break;
        } else if (!arg.startsWith('-')) {
          targetUser = arg;
        }
      }

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      if (targetUser !== 'root' && !passwdContent.includes(`${targetUser}:`)) {
        return { stdout: '', stderr: `su: user ${targetUser} does not exist\n`, exitCode: 1 };
      }

      if (commandToRun) {
        const parts = commandToRun.split(/\s+/);
        const subCmd = parts[0];
        const subArgs = parts.slice(1);
        const { globalCommandRegistry } = await import('../commandRegistry');
        return await globalCommandRegistry.execute(subCmd, { ...ctx, args: subArgs, env: { ...ctx.env, USER: targetUser } });
      }

      ctx.env['USER'] = targetUser;
      ctx.env['HOME'] = targetUser === 'root' ? '/root' : `/home/${targetUser}`;
      if (isLoginEnv) {
        ctx.env['LOGNAME'] = targetUser;
        ctx.env['SHELL'] = '/bin/bash';
      }
      ctx.vfs.changeDirectory(ctx.env['HOME'], targetUser);
      ctx.env['PWD'] = ctx.vfs.getPwd();

      return { stdout: `Switched to user ${targetUser}.\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'passwd',
    description: 'Change user password (-d, -l, -u)',
    category: 'sys',
    execute: (ctx) => {
      let username = ctx.env['USER'] || 'hello';
      let deletePass = false;
      let lockPass = false;
      let newPass: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-d' || arg === '--delete') {
          deletePass = true;
        } else if (arg === '-l' || arg === '--lock') {
          lockPass = true;
        } else if (!arg.startsWith('-')) {
          if (!newPass && username !== ctx.env['USER']) {
            newPass = arg;
          } else {
            username = arg;
          }
        }
      }

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      const lines = shadowContent.split('\n');
      let updated = false;

      const newLines = lines.map((line) => {
        if (line.startsWith(`${username}:`)) {
          updated = true;
          const parts = line.split(':');
          if (deletePass) {
            parts[1] = '';
          } else if (lockPass) {
            parts[1] = '!' + parts[1];
          } else {
            parts[1] = newPass || username;
          }
          return parts.join(':');
        }
        return line;
      });

      if (!updated) {
        newLines.push(`${username}:${newPass || username}:19000:0:99999:7:::`);
      }

      ctx.vfs.writeFile('/etc/shadow', newLines.join('\n'));
      return {
        stdout: `passwd: password updated for ${username} successfully.\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'logout',
    description: 'Exit a login shell',
    category: 'sys',
    execute: () => {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        logout: true,
      };
    },
  },
  {
    name: 'groupadd',
    description: 'Create a new group (-g <gid>, -r)',
    category: 'sys',
    execute: (ctx) => {
      let customGid: number | null = null;
      let groupname: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-g' && ctx.args[i + 1]) {
          customGid = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (!arg.startsWith('-')) {
          groupname = arg;
        }
      }

      if (!groupname) return { stdout: '', stderr: 'groupadd: missing group name\nUsage: groupadd [options] GROUP\n', exitCode: 1 };

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      if (groupContent.includes(`${groupname}:`)) {
        return { stdout: '', stderr: `groupadd: group '${groupname}' already exists\n`, exitCode: 9 };
      }

      const existingGids = groupContent
        .split('\n')
        .map((l) => parseInt(l.split(':')[2], 10))
        .filter((g) => !isNaN(g));
      const gid = customGid !== null && !isNaN(customGid) ? customGid : (existingGids.length > 0 ? Math.max(...existingGids, 999) + 1 : 1000);

      ctx.vfs.writeFile('/etc/group', groupContent + (groupContent.endsWith('\n') ? '' : '\n') + `${groupname}:x:${gid}:\n`);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'groupdel',
    description: 'Delete a group',
    category: 'sys',
    execute: (ctx) => {
      const groupname = ctx.args.find((a) => !a.startsWith('-'));
      if (!groupname) return { stdout: '', stderr: 'groupdel: missing group name\nUsage: groupdel GROUP\n', exitCode: 1 };

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      if (!groupContent.includes(`${groupname}:`)) {
        return { stdout: '', stderr: `groupdel: group '${groupname}' does not exist\n`, exitCode: 6 };
      }

      const lines = groupContent.split('\n').filter((l) => !l.startsWith(`${groupname}:`));
      ctx.vfs.writeFile('/etc/group', lines.join('\n'));
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'groups',
    description: 'Print the groups a user is in',
    category: 'sys',
    execute: (ctx) => {
      const targetUsers = ctx.args.filter((a) => !a.startsWith('-'));
      const usersToQuery = targetUsers.length > 0 ? targetUsers : [ctx.env['USER'] || 'hello'];

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      const groupLines = groupContent.split('\n');

      const outLines: string[] = [];
      for (const u of usersToQuery) {
        const matchedGroups: string[] = [u];
        for (const line of groupLines) {
          const parts = line.split(':');
          if (parts[0] && parts[3] && parts[3].split(',').includes(u)) {
            matchedGroups.push(parts[0]);
          }
        }
        if (targetUsers.length > 1) {
          outLines.push(`${u} : ${matchedGroups.join(' ')}`);
        } else {
          outLines.push(matchedGroups.join(' '));
        }
      }

      return { stdout: outLines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'sudo',
    description: 'Execute a command as another user or superuser (-u, -s, -i)',
    category: 'sys',
    execute: async (ctx) => {
      if (ctx.args.length === 0) {
        return { stdout: '', stderr: 'usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABknS] [-g group] [-h host] [-p prompt] [-u user] [command]\n', exitCode: 1 };
      }

      const currentUser = ctx.env['USER'] || 'hello';

      if (ctx.args[0] === '-i' || ctx.args[0] === '-s') {
        ctx.env['USER'] = 'root';
        ctx.env['HOME'] = '/root';
        ctx.vfs.changeDirectory('/root', 'root');
        ctx.env['PWD'] = ctx.vfs.getPwd();
        return { stdout: 'Switched to root shell.\n', stderr: '', exitCode: 0 };
      }

      // If already root, execute directly
      if (currentUser === 'root') {
        const subCmd = ctx.args[0];
        const subArgs = ctx.args.slice(1);
        const { globalCommandRegistry } = await import('../commandRegistry');
        return await globalCommandRegistry.execute(subCmd, { ...ctx, args: subArgs });
      }

      // Return sudoPrompt for password entry
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        sudoPrompt: { username: currentUser, commandLine: ctx.args.join(' ') },
      };
    },
  },
  {
    name: 'login',
    description: 'Begin session on the system',
    category: 'sys',
    execute: (ctx) => {
      const targetUser = ctx.args[0] || 'hello';
      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';

      if (targetUser !== 'root' && !passwdContent.includes(`${targetUser}:`)) {
        return { stdout: '', stderr: `login: user '${targetUser}' does not exist\n`, exitCode: 1 };
      }

      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        loginPrompt: { username: targetUser },
      };
    },
  },
  {
    name: 'who',
    description: 'Show who is logged on (-a, -q, -b, -u)',
    category: 'sys',
    execute: (ctx) => {
      const user = ctx.env['USER'] || 'hello';
      const isCount = ctx.args.includes('-q') || ctx.args.includes('--count');
      const isBoot = ctx.args.includes('-b') || ctx.args.includes('--boot');

      if (isCount) {
        return { stdout: `${user}\n# users=1\n`, stderr: '', exitCode: 0 };
      }
      if (isBoot) {
        const d = new Date(Date.now() - 2 * 86400000 - 4 * 3600000);
        return { stdout: `         system boot  ${d.toISOString().slice(0, 16).replace('T', ' ')}\n`, stderr: '', exitCode: 0 };
      }

      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
      return { stdout: `${user.padEnd(10)} tty1         ${nowStr} (:0)\n`, stderr: '', exitCode: 0 };
    },
  },
];

