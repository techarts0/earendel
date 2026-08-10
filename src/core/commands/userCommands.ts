// Behavioral User & Permission Management Commands for Earendel
import { Command } from '../types';

export const userCommands: Command[] = [
  {
    name: 'chown',
    description: 'Change file owner and group',
    category: 'file',
    execute: (ctx) => {
      const recursive = ctx.args.includes('-R') || ctx.args.includes('-r');
      const owner = ctx.args.find((a) => !a.startsWith('-'));
      const file = ctx.args.slice(ctx.args.indexOf(owner!) + 1).find((a) => !a.startsWith('-'));

      if (!owner || !file) {
        return { stdout: '', stderr: 'chown: missing operand\nUsage: chown [-R] OWNER[:GROUP] FILE\n', exitCode: 1 };
      }

      const node = ctx.vfs.getNodeByPath(file);
      if (!node) {
        return { stdout: '', stderr: `chown: cannot access '${file}': No such file or directory\n`, exitCode: 1 };
      }

      const parts = owner.split(':');
      node.owner = parts[0];
      if (parts[1]) node.group = parts[1];

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'useradd',
    description: 'Create a new user',
    category: 'sys',
    execute: (ctx) => {
      const username = ctx.args.find((a) => !a.startsWith('-'));
      if (!username) return { stdout: '', stderr: 'useradd: missing username\n', exitCode: 1 };

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      if (passwdContent.includes(`${username}:`)) {
        return { stdout: '', stderr: `useradd: user '${username}' already exists\n`, exitCode: 9 };
      }

      const existingUids = passwdContent
        .split('\n')
        .map((l) => parseInt(l.split(':')[2], 10))
        .filter((u) => !isNaN(u));
      const uid = existingUids.length > 0 ? Math.max(...existingUids, 999) + 1 : 1000;

      const newPasswdLine = `${username}:x:${uid}:${uid}:${username}:/home/${username}:/bin/bash\n`;
      ctx.vfs.writeFile('/etc/passwd', passwdContent + (passwdContent.endsWith('\n') ? '' : '\n') + newPasswdLine);

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      ctx.vfs.writeFile('/etc/shadow', shadowContent + `${username}:${username}:19000:0:99999:7:::\n`);

      ctx.vfs.mkdir(`/home/${username}`, true);

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'userdel',
    description: 'Delete a user account and related files',
    category: 'sys',
    execute: (ctx) => {
      const username = ctx.args.find((a) => !a.startsWith('-'));
      if (!username) return { stdout: '', stderr: 'userdel: missing username\n', exitCode: 1 };

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      const lines = passwdContent.split('\n').filter((l) => !l.startsWith(`${username}:`));
      ctx.vfs.writeFile('/etc/passwd', lines.join('\n'));

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      const sLines = shadowContent.split('\n').filter((l) => !l.startsWith(`${username}:`));
      ctx.vfs.writeFile('/etc/shadow', sLines.join('\n'));

      if (ctx.args.includes('-r')) {
        ctx.vfs.remove(`/home/${username}`, true);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'su',
    description: 'Change user ID or become superuser',
    category: 'sys',
    execute: (ctx) => {
      const username = ctx.args.find((a) => !a.startsWith('-')) || 'root';
      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';

      if (username !== 'root' && !passwdContent.includes(`${username}:`)) {
        return { stdout: '', stderr: `su: user ${username} does not exist\n`, exitCode: 1 };
      }

      ctx.env['USER'] = username;
      ctx.env['HOME'] = username === 'root' ? '/root' : `/home/${username}`;
      ctx.vfs.changeDirectory(ctx.env['HOME'], username);

      return { stdout: `Switched to user ${username}.\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'passwd',
    description: 'Change user password',
    category: 'sys',
    execute: (ctx) => {
      let username = ctx.env['USER'] || 'hello';
      let newPass = ctx.args[0];

      if (ctx.args.length >= 2) {
        username = ctx.args[0];
        newPass = ctx.args[1];
      }

      if (!newPass) {
        return {
          stdout: `Changing password for user ${username}.\nUsage: passwd [username] <new_password>\npasswd: password updated to default '${username}'.\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      const lines = shadowContent.split('\n');
      let updated = false;

      const newLines = lines.map((line) => {
        if (line.startsWith(`${username}:`)) {
          updated = true;
          const parts = line.split(':');
          parts[1] = newPass;
          return parts.join(':');
        }
        return line;
      });

      if (!updated) {
        newLines.push(`${username}:${newPass}:19000:0:99999:7:::`);
      }

      ctx.vfs.writeFile('/etc/shadow', newLines.join('\n'));
      return {
        stdout: `Changing password for user ${username}.\npasswd: all authentication tokens updated successfully.\n`,
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
    description: 'Create a new group',
    category: 'sys',
    execute: (ctx) => {
      const groupname = ctx.args.find((a) => !a.startsWith('-'));
      if (!groupname) return { stdout: '', stderr: 'groupadd: missing group name\n', exitCode: 1 };

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      if (groupContent.includes(`${groupname}:`)) {
        return { stdout: '', stderr: `groupadd: group '${groupname}' already exists\n`, exitCode: 9 };
      }

      const gid = 1000 + Math.floor(Math.random() * 8000);
      ctx.vfs.writeFile('/etc/group', groupContent + `${groupname}:x:${gid}:\n`);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'groupdel',
    description: 'Delete a group',
    category: 'sys',
    execute: (ctx) => {
      const groupname = ctx.args.find((a) => !a.startsWith('-'));
      if (!groupname) return { stdout: '', stderr: 'groupdel: missing group name\n', exitCode: 1 };

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
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
      const user = ctx.args[0] || ctx.env['USER'] || 'hello';
      return { stdout: `${user} : ${user} sudo adm cdrom dip plugdev\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'sudo',
    description: 'Execute a command as another user or superuser',
    category: 'sys',
    execute: async (ctx) => {
      if (ctx.args.length === 0) {
        return { stdout: '', stderr: 'usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABknS] [-g group] [-h host] [-p prompt] [-u user]\n', exitCode: 1 };
      }

      const currentUser = ctx.env['USER'] || 'hello';

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
    description: 'Show who is logged on',
    category: 'sys',
    execute: (ctx) => {
      const user = ctx.env['USER'] || 'hello';
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 16);
      return { stdout: `${user.padEnd(10)} tty1         ${nowStr} (:0)\n`, stderr: '', exitCode: 0 };
    },
  },
];
