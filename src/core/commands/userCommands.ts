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
            if (oldOwnerGroup !== newOwnerGroup) {
              totalStdout += `changed ownership of '${target}' from ${oldOwnerGroup} to ${newOwnerGroup}\n`;
            } else {
              totalStdout += `ownership of '${target}' retained as ${newOwnerGroup}\n`;
            }
          } else if (changesOnly && oldOwnerGroup !== newOwnerGroup) {
            totalStdout += `changed ownership of '${target}' from ${oldOwnerGroup} to ${newOwnerGroup}\n`;
          }
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'chgrp',
    description: 'Change group ownership of files (supports -R, -v, -c, -f)',
    category: 'file',
    execute: (ctx) => {
      const flags = new Set<string>();
      let targetGroup: string | null = null;
      const targets: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else if (!targetGroup) {
          targetGroup = arg;
        } else {
          targets.push(arg);
        }
      }

      if (!targetGroup || targets.length === 0) {
        return { stdout: '', stderr: 'chgrp: missing operand\nUsage: chgrp [-R] GROUP FILE...\n', exitCode: 1 };
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
            totalStderr += `chgrp: cannot access '${target}': No such file or directory\n`;
          }
          exitCode = 1;
          continue;
        }

        const oldGroup = node.group;
        const ok = ctx.vfs.chown(target, `:${targetGroup}`, recursive);
        if (!ok) {
          if (!silent) {
            totalStderr += `chgrp: changing group of '${target}': Operation not permitted\n`;
          }
          exitCode = 1;
        } else {
          const newGroup = node.group;
          if (verbose) {
            if (oldGroup !== newGroup) {
              totalStdout += `changed group of '${target}' from ${oldGroup} to ${newGroup}\n`;
            } else {
              totalStdout += `group of '${target}' retained as ${newGroup}\n`;
            }
          } else if (changesOnly && oldGroup !== newGroup) {
            totalStdout += `changed group of '${target}' from ${oldGroup} to ${newGroup}\n`;
          }
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'useradd',
    description: 'Create a new user (-u, -g, -d, -c, -s, -m, -o, -G)',
    category: 'sys',
    execute: (ctx) => {
      let explicitCreateHome = false;
      let explicitNoCreateHome = false;
      let shell = '/bin/bash';
      let homeDir: string | null = null;
      let comment: string = '';
      let customUid: number | null = null;
      let allowDuplicateUid = false;
      let primaryGroup: string | null = null;
      let username: string | null = null;

      let supplementaryGroups: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-m' || arg === '--create-home') {
          explicitCreateHome = true;
        } else if (arg === '-M' || arg === '--no-create-home') {
          explicitNoCreateHome = true;
        } else if (arg === '-s' && ctx.args[i + 1]) {
          shell = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-s=')) {
          shell = arg.slice(3);
        } else if (arg === '-d' && ctx.args[i + 1]) {
          homeDir = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-d=')) {
          homeDir = arg.slice(3);
        } else if (arg === '-c' && ctx.args[i + 1]) {
          comment = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-c=')) {
          comment = arg.slice(3);
        } else if (arg === '-u' && ctx.args[i + 1]) {
          customUid = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg.startsWith('-u=')) {
          customUid = parseInt(arg.slice(3), 10);
        } else if (arg === '-o' || arg === '--non-unique') {
          allowDuplicateUid = true;
        } else if (arg === '-g' && ctx.args[i + 1]) {
          primaryGroup = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-g=')) {
          primaryGroup = arg.slice(3);
        } else if (arg === '-G' && ctx.args[i + 1]) {
          supplementaryGroups = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-G=')) {
          supplementaryGroups = arg.slice(3);
        } else if (!arg.startsWith('-')) {
          username = arg;
        }
      }

      if (!username) {
        return {
          stdout: '',
          stderr: 'Usage: useradd [options] LOGIN\n\nOptions:\n  -c, --comment COMMENT         GECOS field of the new account\n  -d, --home-dir HOME_DIR       home directory of the new account\n  -g, --gid GROUP               name or ID of the primary group of the new account\n  -G, --groups GROUPS           list of supplementary groups of the new account\n  -m, --create-home             create the user\'s home directory\n  -o, --non-unique              allow to create users with duplicate (non-unique) UID\n  -s, --shell SHELL             login shell of the new account\n  -u, --uid UID                 user ID of the new account\n',
          exitCode: 1,
        };
      }

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      if (passwdContent.includes(`${username}:`)) {
        return { stdout: '', stderr: `useradd: user '${username}' already exists\n`, exitCode: 9 };
      }

      const existingUids = passwdContent
        .split('\n')
        .map((l) => parseInt(l.split(':')[2], 10))
        .filter((u) => !isNaN(u));

      // Check UID collision if -o is not provided
      if (customUid !== null && !isNaN(customUid)) {
        if (!allowDuplicateUid && existingUids.includes(customUid)) {
          return { stdout: '', stderr: `useradd: UID ${customUid} is not unique\n`, exitCode: 4 };
        }
      }

      const uid = customUid !== null && !isNaN(customUid) ? customUid : (existingUids.length > 0 ? Math.max(...existingUids, 999) + 1 : 1000);

      // Determine primary GID
      let gid = uid;
      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      let groupLines = groupContent.split('\n');

      if (primaryGroup) {
        const parsedGid = parseInt(primaryGroup, 10);
        let found = false;
        for (const line of groupLines) {
          const parts = line.split(':');
          if (parts[0] === primaryGroup || (!isNaN(parsedGid) && parseInt(parts[2], 10) === parsedGid)) {
            gid = parseInt(parts[2], 10);
            found = true;
            break;
          }
        }
        if (!found) {
          return { stdout: '', stderr: `useradd: group '${primaryGroup}' does not exist\n`, exitCode: 6 };
        }
      } else {
        // Create user's private group with same name and gid=uid if not already exists
        if (!groupContent.includes(`${username}:`)) {
          groupLines.push(`${username}:x:${gid}:`);
        }
      }

      // Add to supplementary groups (-G)
      if (supplementaryGroups) {
        const suppGroupNames = supplementaryGroups.split(',').map((g) => g.trim()).filter(Boolean);
        for (const gName of suppGroupNames) {
          const exists = groupLines.some((l) => l.split(':')[0] === gName);
          if (!exists) {
            return { stdout: '', stderr: `useradd: group '${gName}' does not exist\n`, exitCode: 6 };
          }
        }

        groupLines = groupLines.map((line) => {
          if (!line.trim()) return line;
          const parts = line.split(':');
          if (suppGroupNames.includes(parts[0])) {
            const members = (parts[3] || '').split(',').map((m) => m.trim()).filter(Boolean);
            if (!members.includes(username!)) members.push(username!);
            parts[3] = members.join(',');
            return parts.join(':');
          }
          return line;
        });
      }

      ctx.vfs.writeFile('/etc/group', groupLines.filter(Boolean).join('\n') + '\n');

      const userHome = homeDir || `/home/${username}`;
      const userComment = comment || username;
      const newPasswdLine = `${username}:x:${uid}:${gid}:${userComment}:${userHome}:${shell}\n`;
      ctx.vfs.writeFile('/etc/passwd', passwdContent + (passwdContent.endsWith('\n') ? '' : '\n') + newPasswdLine);

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      ctx.vfs.writeFile('/etc/shadow', shadowContent + (shadowContent.endsWith('\n') ? '' : '\n') + `${username}:${username}:19000:0:99999:7:::\n`);

      // Create home directory if -m is specified, or default create home when not explicitly disabled by -M
      const shouldCreateHome = explicitCreateHome || (!explicitNoCreateHome && !homeDir);
      if (shouldCreateHome) {
        ctx.vfs.mkdir(userHome, true);
        ctx.vfs.chown(userHome, `${username}:${primaryGroup || username}`, true);
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
      let force = false;
      let username: string | null = null;

      for (const arg of ctx.args) {
        if (arg === '-r' || arg === '--remove') {
          removeHome = true;
        } else if (arg === '-f' || arg === '--force') {
          force = true;
        } else if (arg === '-rf' || arg === '-fr') {
          removeHome = true;
          force = true;
        } else if (!arg.startsWith('-')) {
          username = arg;
        }
      }

      if (!username) {
        return { stdout: '', stderr: 'Usage: userdel [options] LOGIN\n\nOptions:\n  -f, --force                   force removal of files, even if not owned by user\n  -r, --remove                  remove home directory and mail spool\n', exitCode: 1 };
      }

      // Check if user is currently logged in
      const currentUser = ctx.env['USER'] || 'root';
      if (username === currentUser && !force) {
        return { stdout: '', stderr: `userdel: user ${username} is currently used by process\n`, exitCode: 8 };
      }

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      const passwdLines = passwdContent.split('\n');
      const userLine = passwdLines.find((l) => l.startsWith(`${username}:`));

      if (!userLine) {
        return { stdout: '', stderr: `userdel: user '${username}' does not exist\n`, exitCode: 6 };
      }

      const userParts = userLine.split(':');
      const userHome = userParts[5] || `/home/${username}`;

      // Remove from /etc/passwd
      const remainingPasswd = passwdLines.filter((l) => !l.startsWith(`${username}:`));
      ctx.vfs.writeFile('/etc/passwd', remainingPasswd.join('\n'));

      // Remove from /etc/shadow
      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      const remainingShadow = shadowContent.split('\n').filter((l) => !l.startsWith(`${username}:`));
      ctx.vfs.writeFile('/etc/shadow', remainingShadow.join('\n'));

      // Remove user from supplementary groups in /etc/group
      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      const remainingGroup = groupContent.split('\n').map((l) => {
        if (!l.trim()) return l;
        const parts = l.split(':');
        // Also remove user's primary group if it has the same name and no other members
        if (parts[3]) {
          const members = parts[3].split(',').map((m) => m.trim()).filter((m) => m && m !== username);
          parts[3] = members.join(',');
        }
        return parts.join(':');
      }).filter((l) => {
        // If the group is user's private group and empty, remove it (standard userdel behavior)
        const parts = l.split(':');
        return !(parts[0] === username && (!parts[3] || parts[3].trim() === ''));
      });
      ctx.vfs.writeFile('/etc/group', remainingGroup.join('\n'));

      // Remove home directory and mail spool if -r or -f is specified
      if (removeHome || force) {
        if (userHome && userHome !== '/' && userHome !== '/root') {
          ctx.vfs.remove(userHome, true);
        }
        // Also clean up mail spool if exists
        const mailSpool = `/var/mail/${username}`;
        if (ctx.vfs.getNodeByPath(mailSpool)) {
          ctx.vfs.remove(mailSpool, true);
        }
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
      const currentUser = ctx.env['USER'] || 'hello';
      let username = currentUser;
      let deletePass = false;
      let lockPass = false;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-d' || arg === '--delete') {
          deletePass = true;
        } else if (arg === '-l' || arg === '--lock') {
          lockPass = true;
        } else if (!arg.startsWith('-')) {
          username = arg;
        }
      }

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      if (username !== 'root' && !passwdContent.includes(`${username}:`)) {
        return { stdout: '', stderr: `passwd: user '${username}' does not exist\n`, exitCode: 1 };
      }

      // Non-root users can only change their own password
      if (currentUser !== 'root' && username !== currentUser) {
        return { stdout: '', stderr: 'passwd: You may not view or modify password information for ' + username + '.\n', exitCode: 1 };
      }

      const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
      const lines = shadowContent.split('\n');

      if (deletePass) {
        const newLines = lines.map((line) => {
          if (line.startsWith(`${username}:`)) {
            const parts = line.split(':');
            parts[1] = '';
            return parts.join(':');
          }
          return line;
        });
        ctx.vfs.writeFile('/etc/shadow', newLines.join('\n'));
        return { stdout: `passwd: password expiry information changed.\n`, stderr: '', exitCode: 0 };
      }

      if (lockPass) {
        const newLines = lines.map((line) => {
          if (line.startsWith(`${username}:`)) {
            const parts = line.split(':');
            if (!parts[1].startsWith('!')) parts[1] = '!' + parts[1];
            return parts.join(':');
          }
          return line;
        });
        ctx.vfs.writeFile('/etc/shadow', newLines.join('\n'));
        return { stdout: `passwd: password expiry information changed.\n`, stderr: '', exitCode: 0 };
      }

      // Interactive flow:
      // If current user is not root, must first ask for Current password
      // If root, directly ask for New password
      const initialStep = currentUser === 'root' ? 'new' : 'current';
      return {
        stdout: `Changing password for ${username}.\n`,
        stderr: '',
        exitCode: 0,
        passwdPrompt: {
          username,
          step: initialStep,
        },
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
  {
    name: 'id',
    description: 'Print real and effective user and group IDs (-u, -g, -G, -n, -r)',
    category: 'sys',
    execute: (ctx) => {
      const flags = new Set<string>();
      let targetUser: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else if (!targetUser) {
          targetUser = arg;
        }
      }

      const currentUser = ctx.env['USER'] || 'hello';
      const username = targetUser || currentUser;

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      let uid = username === 'root' ? 0 : 1000;
      let gid = username === 'root' ? 0 : 1000;
      let userFound = username === 'root' || username === 'hello';

      const passwdLines = passwdContent.split('\n');
      for (const line of passwdLines) {
        const parts = line.split(':');
        if (parts[0] === username) {
          userFound = true;
          const parsedUid = parseInt(parts[2], 10);
          const parsedGid = parseInt(parts[3], 10);
          if (!isNaN(parsedUid)) uid = parsedUid;
          if (!isNaN(parsedGid)) gid = parsedGid;
          break;
        }
      }

      if (!userFound && passwdContent.length > 0) {
        return { stdout: '', stderr: `id: '${username}': no such user\n`, exitCode: 1 };
      }

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      const groupLines = groupContent.split('\n');
      const userGroups: { gid: number; name: string }[] = [];

      // Primary group
      let primaryGroupName = username;
      for (const line of groupLines) {
        const parts = line.split(':');
        if (parseInt(parts[2], 10) === gid) {
          primaryGroupName = parts[0];
          break;
        }
      }
      userGroups.push({ gid, name: primaryGroupName });

      // Supplementary groups
      for (const line of groupLines) {
        const parts = line.split(':');
        if (parts[0] && parts[2] && parts[3]) {
          const gId = parseInt(parts[2], 10);
          const gMembers = parts[3].split(',').map((m) => m.trim());
          if (gMembers.includes(username) && gId !== gid) {
            userGroups.push({ gid: gId, name: parts[0] });
          }
        }
      }

      // If user is hello or root and groups are empty in simulated VFS, add standard system groups
      if (userGroups.length === 1 && username === 'hello') {
        const defaultGroups = [
          { gid: 4, name: 'adm' },
          { gid: 24, name: 'cdrom' },
          { gid: 27, name: 'sudo' },
          { gid: 30, name: 'dip' },
          { gid: 46, name: 'plugdev' },
        ];
        userGroups.push(...defaultGroups);
      }

      const onlyUser = flags.has('u') || flags.has('user');
      const onlyGroup = flags.has('g') || flags.has('group');
      const allGroups = flags.has('G') || flags.has('groups');
      const nameOnly = flags.has('n') || flags.has('name');

      if (onlyUser) {
        return { stdout: (nameOnly ? username : uid.toString()) + '\n', stderr: '', exitCode: 0 };
      }
      if (onlyGroup) {
        return { stdout: (nameOnly ? primaryGroupName : gid.toString()) + '\n', stderr: '', exitCode: 0 };
      }
      if (allGroups) {
        const outStr = nameOnly ? userGroups.map((g) => g.name).join(' ') : userGroups.map((g) => g.gid).join(' ');
        return { stdout: outStr + '\n', stderr: '', exitCode: 0 };
      }

      // Default full id output format: uid=1000(hello) gid=1000(hello) groups=1000(hello),4(adm),...
      const groupsStr = userGroups.map((g) => `${g.gid}(${g.name})`).join(',');
      const fullOut = `uid=${uid}(${username}) gid=${gid}(${primaryGroupName}) groups=${groupsStr}\n`;

      return { stdout: fullOut, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'usermod',
    description: 'Modify a user account (-a, -G, -g, -d, -s, -l, -u, -L, -U)',
    category: 'sys',
    execute: (ctx) => {
      let appendGroups = false;
      let newGroups: string | null = null;
      let newPrimaryGroup: string | null = null;
      let newHome: string | null = null;
      let moveHome = false;
      let newShell: string | null = null;
      let newLogin: string | null = null;
      let newUid: number | null = null;
      let newComment: string | null = null;
      let allowDuplicateUid = false;
      let lockAccount = false;
      let unlockAccount = false;
      let username: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-a' || arg === '--append') {
          appendGroups = true;
        } else if (arg === '-G' && ctx.args[i + 1]) {
          newGroups = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-G=')) {
          newGroups = arg.slice(3);
        } else if (arg === '-aG' || arg === '-Ga') {
          appendGroups = true;
          if (ctx.args[i + 1]) {
            newGroups = ctx.args[i + 1];
            i++;
          }
        } else if (arg === '-g' && ctx.args[i + 1]) {
          newPrimaryGroup = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-g=')) {
          newPrimaryGroup = arg.slice(3);
        } else if (arg === '-d' && ctx.args[i + 1]) {
          newHome = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-d=')) {
          newHome = arg.slice(3);
        } else if (arg === '-c' && ctx.args[i + 1]) {
          newComment = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-c=')) {
          newComment = arg.slice(3);
        } else if (arg === '-m' || arg === '--move-home') {
          moveHome = true;
        } else if (arg === '-o' || arg === '--non-unique') {
          allowDuplicateUid = true;
        } else if (arg === '-s' && ctx.args[i + 1]) {
          newShell = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-s=')) {
          newShell = arg.slice(3);
        } else if (arg === '-l' && ctx.args[i + 1]) {
          newLogin = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-l=')) {
          newLogin = arg.slice(3);
        } else if (arg === '-u' && ctx.args[i + 1]) {
          newUid = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg.startsWith('-u=')) {
          newUid = parseInt(arg.slice(3), 10);
        } else if (arg === '-L' || arg === '--lock') {
          lockAccount = true;
        } else if (arg === '-U' || arg === '--unlock') {
          unlockAccount = true;
        } else if (!arg.startsWith('-')) {
          username = arg;
        }
      }

      if (!username) {
        return {
          stdout: '',
          stderr: 'Usage: usermod [options] LOGIN\n\nOptions:\n  -c, --comment COMMENT         new value of the GECOS field\n  -d, --home HOME_DIR           new home directory for user account\n  -m, --move-home               move contents of home directory to new location (use with -d)\n  -g, --gid GROUP               force use GROUP as new primary group\n  -G, --groups GROUPS           new list of supplementary groups\n  -a, --append                  append user to supplementary groups (use with -G)\n  -l, --login NEW_LOGIN         new value of the login name\n  -s, --shell SHELL             new login shell\n  -u, --uid UID                 new UID\n  -o, --non-unique              allow using duplicate (non-unique) UID when with -u\n  -L, --lock                    lock user account\n  -U, --unlock                  unlock user account\n',
          exitCode: 2,
        };
      }

      const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
      const passwdLines = passwdContent.split('\n');
      const userIndex = passwdLines.findIndex((line) => line.startsWith(`${username}:`));
      if (userIndex === -1) {
        return { stdout: '', stderr: `usermod: user '${username}' does not exist\n`, exitCode: 6 };
      }

      const userParts = passwdLines[userIndex].split(':');
      const oldHome = userParts[5];

      // Handle new login name collision
      if (newLogin && newLogin !== username) {
        if (passwdLines.some((l) => l.startsWith(`${newLogin}:`))) {
          return { stdout: '', stderr: `usermod: user '${newLogin}' already exists\n`, exitCode: 9 };
        }
      }

      // Check UID uniqueness unless -o is provided
      if (newUid !== null && !isNaN(newUid)) {
        if (!allowDuplicateUid) {
          const uidExists = passwdLines.some((l) => {
            const parts = l.split(':');
            return parts[0] !== username && parseInt(parts[2], 10) === newUid;
          });
          if (uidExists) {
            return { stdout: '', stderr: `usermod: UID '${newUid}' already exists\n`, exitCode: 4 };
          }
        }
      }

      // Handle new primary group
      let resolvedPrimaryGid: number | null = null;
      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      let groupLines = groupContent.split('\n');

      if (newPrimaryGroup) {
        const parsedGid = parseInt(newPrimaryGroup, 10);
        let found = false;
        for (const line of groupLines) {
          const parts = line.split(':');
          if (parts[0] === newPrimaryGroup || (!isNaN(parsedGid) && parseInt(parts[2], 10) === parsedGid)) {
            resolvedPrimaryGid = parseInt(parts[2], 10);
            found = true;
            break;
          }
        }
        if (!found) {
          return { stdout: '', stderr: `usermod: group '${newPrimaryGroup}' does not exist\n`, exitCode: 6 };
        }
      }

      // Supplementary groups (-G)
      if (newGroups !== null) {
        const targetGroupNames = newGroups.split(',').map((g) => g.trim()).filter(Boolean);
        // Verify groups exist
        for (const gName of targetGroupNames) {
          const exists = groupLines.some((l) => l.split(':')[0] === gName);
          if (!exists) {
            return { stdout: '', stderr: `usermod: group '${gName}' does not exist\n`, exitCode: 6 };
          }
        }

        groupLines = groupLines.map((line) => {
          if (!line.trim()) return line;
          const parts = line.split(':');
          const gName = parts[0];
          let members = (parts[3] || '').split(',').map((m) => m.trim()).filter(Boolean);

          if (appendGroups) {
            if (targetGroupNames.includes(gName) && !members.includes(username!)) {
              members.push(username!);
            }
          } else {
            // Replace supplementary groups
            if (targetGroupNames.includes(gName)) {
              if (!members.includes(username!)) members.push(username!);
            } else {
              members = members.filter((m) => m !== username);
            }
          }

          parts[3] = members.join(',');
          return parts.join(':');
        });

        ctx.vfs.writeFile('/etc/group', groupLines.join('\n'));
      }

      // Update /etc/passwd fields
      // Format: username:password:uid:gid:comment:home:shell
      if (newLogin) userParts[0] = newLogin;
      if (newUid !== null && !isNaN(newUid)) userParts[2] = newUid.toString();
      if (resolvedPrimaryGid !== null) userParts[3] = resolvedPrimaryGid.toString();
      if (newComment !== null) userParts[4] = newComment;
      if (newHome) userParts[5] = newHome;
      if (newShell) userParts[6] = newShell;
      passwdLines[userIndex] = userParts.join(':');
      ctx.vfs.writeFile('/etc/passwd', passwdLines.join('\n'));

      // If username renamed, rename in /etc/group and /etc/shadow
      if (newLogin && newLogin !== username) {
        const finalGroupContent = ctx.vfs.readFile('/etc/group') ?? '';
        const updatedGroups = finalGroupContent.split('\n').map((l) => {
          const parts = l.split(':');
          if (parts[0] === username) parts[0] = newLogin!;
          if (parts[3]) {
            parts[3] = parts[3].split(',').map((m) => (m.trim() === username ? newLogin! : m.trim())).join(',');
          }
          return parts.join(':');
        });
        ctx.vfs.writeFile('/etc/group', updatedGroups.join('\n'));

        const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
        const updatedShadow = shadowContent.split('\n').map((l) => {
          if (l.startsWith(`${username}:`)) {
            return `${newLogin}:${l.slice(username!.length + 1)}`;
          }
          return l;
        });
        ctx.vfs.writeFile('/etc/shadow', updatedShadow.join('\n'));
      }

      // Lock / unlock account
      if (lockAccount || unlockAccount) {
        const currentTarget = newLogin || username;
        const shadowContent = ctx.vfs.readFile('/etc/shadow') ?? '';
        const updatedShadow = shadowContent.split('\n').map((l) => {
          if (l.startsWith(`${currentTarget}:`)) {
            const parts = l.split(':');
            if (lockAccount && !parts[1].startsWith('!')) {
              parts[1] = '!' + parts[1];
            } else if (unlockAccount && parts[1].startsWith('!')) {
              parts[1] = parts[1].replace(/^!+/, '');
            }
            return parts.join(':');
          }
          return l;
        });
        ctx.vfs.writeFile('/etc/shadow', updatedShadow.join('\n'));
      }

      // Move home directory if requested (-m)
      if (moveHome && newHome && oldHome && oldHome !== newHome) {
        const oldNode = ctx.vfs.getNodeByPath(oldHome);
        if (oldNode) {
          // Recursive copy function
          const copySingle = (srcPath: string, targetPath: string) => {
            const node = ctx.vfs.getNodeByPath(srcPath);
            if (!node) return;
            if (node.type === 'directory') {
              ctx.vfs.mkdir(targetPath, true);
              const dirNode = ctx.vfs.getNodeByPath(targetPath);
              if (dirNode) {
                dirNode.permissions = node.permissions;
                dirNode.owner = node.owner;
                dirNode.group = node.group;
              }
              if (node.children) {
                for (const child of node.children.values()) {
                  copySingle(`${srcPath}/${child.name}`, `${targetPath}/${child.name}`);
                }
              }
            } else {
              ctx.vfs.writeFile(targetPath, node.content ?? '');
              const fileNode = ctx.vfs.getNodeByPath(targetPath);
              if (fileNode) {
                fileNode.permissions = node.permissions;
                fileNode.owner = node.owner;
                fileNode.group = node.group;
              }
            }
          };

          copySingle(oldHome, newHome);
          ctx.vfs.remove(oldHome, true);

          const finalOwner = newLogin || username;
          ctx.vfs.chown(newHome, `${finalOwner}:${finalOwner}`, true);
        }
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'groupmod',
    description: 'Modify a group definition on the system (-g <gid>, -n <new_name>)',
    category: 'sys',
    execute: (ctx) => {
      let newGid: number | null = null;
      let newName: string | null = null;
      let groupname: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-g' && ctx.args[i + 1]) {
          newGid = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg.startsWith('-g=')) {
          newGid = parseInt(arg.slice(3), 10);
        } else if (arg === '-n' && ctx.args[i + 1]) {
          newName = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-n=')) {
          newName = arg.slice(3);
        } else if (!arg.startsWith('-')) {
          groupname = arg;
        }
      }

      if (!groupname) {
        return {
          stdout: '',
          stderr: 'Usage: groupmod [options] GROUP\n\nOptions:\n  -g, --gid GID         change the group ID\n  -n, --new-name NEW    change the group name\n',
          exitCode: 2,
        };
      }

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      const lines = groupContent.split('\n');
      const groupIndex = lines.findIndex((l) => l.startsWith(`${groupname}:`));

      if (groupIndex === -1) {
        return { stdout: '', stderr: `groupmod: group '${groupname}' does not exist\n`, exitCode: 6 };
      }

      if (newName && newName !== groupname && lines.some((l) => l.startsWith(`${newName}:`))) {
        return { stdout: '', stderr: `groupmod: group '${newName}' already exists\n`, exitCode: 9 };
      }

      const parts = lines[groupIndex].split(':');
      if (newGid !== null && !isNaN(newGid)) {
        parts[2] = newGid.toString();
      }
      if (newName) {
        parts[0] = newName;
      }
      lines[groupIndex] = parts.join(':');
      ctx.vfs.writeFile('/etc/group', lines.join('\n'));

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'gpasswd',
    description: 'Administer /etc/group and /etc/gshadow (-a, -d, -M, -A, -r, -R)',
    category: 'sys',
    execute: (ctx) => {
      let addUser: string | null = null;
      let delUser: string | null = null;
      let membersList: string | null = null;
      let removePassword = false;
      let groupname: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-a' && ctx.args[i + 1]) {
          addUser = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-a=')) {
          addUser = arg.slice(3);
        } else if (arg === '-d' && ctx.args[i + 1]) {
          delUser = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-d=')) {
          delUser = arg.slice(3);
        } else if (arg === '-M' && ctx.args[i + 1]) {
          membersList = ctx.args[i + 1];
          i++;
        } else if (arg === '-r' || arg === '--delete') {
          removePassword = true;
        } else if (!arg.startsWith('-')) {
          groupname = arg;
        }
      }

      if (!groupname) {
        return {
          stdout: '',
          stderr: 'Usage: gpasswd [option] GROUP\n\nOptions:\n  -a, --add USER              add user to GROUP\n  -d, --delete USER           remove user from GROUP\n  -M, --members USER,...      set the list of members of GROUP\n  -r, --remove-password       remove the GROUP\'s password\n',
          exitCode: 1,
        };
      }

      const groupContent = ctx.vfs.readFile('/etc/group') ?? '';
      const lines = groupContent.split('\n');
      const groupIndex = lines.findIndex((l) => l.startsWith(`${groupname}:`));

      if (groupIndex === -1) {
        return { stdout: '', stderr: `gpasswd: group '${groupname}' does not exist\n`, exitCode: 1 };
      }

      const parts = lines[groupIndex].split(':');
      let currentMembers = (parts[3] || '').split(',').map((m) => m.trim()).filter(Boolean);

      if (addUser) {
        const passwdContent = ctx.vfs.readFile('/etc/passwd') ?? '';
        if (addUser !== 'root' && !passwdContent.includes(`${addUser}:`)) {
          return { stdout: '', stderr: `gpasswd: user '${addUser}' does not exist\n`, exitCode: 1 };
        }
        if (!currentMembers.includes(addUser)) {
          currentMembers.push(addUser);
        }
        parts[3] = currentMembers.join(',');
        lines[groupIndex] = parts.join(':');
        ctx.vfs.writeFile('/etc/group', lines.join('\n'));
        return { stdout: `Adding user ${addUser} to group ${groupname}\n`, stderr: '', exitCode: 0 };
      }

      if (delUser) {
        if (!currentMembers.includes(delUser)) {
          return { stdout: '', stderr: `gpasswd: user '${delUser}' is not a member of '${groupname}'\n`, exitCode: 1 };
        }
        currentMembers = currentMembers.filter((m) => m !== delUser);
        parts[3] = currentMembers.join(',');
        lines[groupIndex] = parts.join(':');
        ctx.vfs.writeFile('/etc/group', lines.join('\n'));
        return { stdout: `Removing user ${delUser} from group ${groupname}\n`, stderr: '', exitCode: 0 };
      }

      if (membersList !== null) {
        const newMembers = membersList.split(',').map((m) => m.trim()).filter(Boolean);
        parts[3] = newMembers.join(',');
        lines[groupIndex] = parts.join(':');
        ctx.vfs.writeFile('/etc/group', lines.join('\n'));
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (removePassword) {
        parts[1] = 'x';
        lines[groupIndex] = parts.join(':');
        ctx.vfs.writeFile('/etc/group', lines.join('\n'));
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      return { stdout: `Password updated for group ${groupname}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'last',
    description: 'Show a listing of last logged in users (-n, -a, -F, -R)',
    category: 'sys',
    execute: (ctx) => {
      let limit: number | null = null;
      let targetUser: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if ((arg === '-n' || arg === '--limit') && ctx.args[i + 1]) {
          limit = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (/^-\d+$/.test(arg)) {
          limit = parseInt(arg.slice(1), 10);
        } else if (!arg.startsWith('-')) {
          targetUser = arg;
        }
      }

      const currentUser = ctx.env['USER'] || 'hello';
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const now = new Date();
      const dayName = days[now.getDay()];
      const monthName = months[now.getMonth()];
      const dateNum = String(now.getDate()).padStart(2, ' ');
      const timeStr = now.toTimeString().substring(0, 5);

      const bootDate = new Date(now.getTime() - 2 * 86400000 - 4 * 3600000);
      const bootDay = days[bootDate.getDay()];
      const bootMonth = months[bootDate.getMonth()];
      const bootDateNum = String(bootDate.getDate()).padStart(2, ' ');
      const bootTimeStr = bootDate.toTimeString().substring(0, 5);

      const prevLoginDate = new Date(now.getTime() - 3600000 * 5);
      const prevDay = days[prevLoginDate.getDay()];
      const prevMonth = months[prevLoginDate.getMonth()];
      const prevDateNum = String(prevLoginDate.getDate()).padStart(2, ' ');
      const prevTimeStr = prevLoginDate.toTimeString().substring(0, 5);

      let records = [
        `${currentUser.padEnd(8)} pts/0        127.0.0.1        ${dayName} ${monthName} ${dateNum} ${timeStr}   still logged in`,
        `root     pts/1        127.0.0.1        ${prevDay} ${prevMonth} ${prevDateNum} ${prevTimeStr} - ${timeStr}  (05:00)`,
        `${currentUser.padEnd(8)} tty1         :0               ${prevDay} ${prevMonth} ${prevDateNum} 09:15 - 18:20  (09:05)`,
        `reboot   system boot  5.15.0-88-generi ${bootDay} ${bootMonth} ${bootDateNum} ${bootTimeStr}   still running`,
      ];

      if (targetUser) {
        records = records.filter((r) => r.startsWith(targetUser!));
      }

      if (limit !== null && !isNaN(limit) && limit > 0) {
        records = records.slice(0, limit);
      }

      const btimeStr = `${bootDay} ${bootMonth} ${bootDateNum} ${bootTimeStr}`;
      const output = records.join('\n') + `\n\nwtmp begins ${btimeStr}\n`;

      return { stdout: output, stderr: '', exitCode: 0 };
    },
  },
];

