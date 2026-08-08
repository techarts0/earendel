import { Command } from '../types';
import { globalDockerEngine } from '../dockerEngine';

export const dockerCommands: Command[] = [
  {
    name: 'docker',
    description: 'Create and manage Docker containers and images',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];

      if (!sub) {
        return {
          stdout: `Usage:  docker [OPTIONS] COMMAND\n\nA self-sufficient runtime for containers\n\nCommands:\n  ps          List containers\n  images      List images\n  run         Create and run a new container from an image\n  stop        Stop one or more running containers\n  rm          Remove one or more containers\n  exec        Execute a command in a running container\n  version     Show the Docker version information\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      if (sub === 'version') {
        const out = [
          'Client: Docker Engine - Community',
          ' Version:           24.0.5',
          ' API version:       1.43',
          ' Go version:        go1.20.6',
          ' Git commit:        ced0996',
          ' Built:             Fri Jul 21 20:32:30 2023',
          ' OS/Arch:           linux/amd64',
          ' Context:           default',
        ].join('\n');
        return { stdout: out + '\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'images') {
        const imgs = globalDockerEngine.getImages();
        let out = 'REPOSITORY'.padEnd(20) + 'TAG'.padEnd(16) + 'IMAGE ID'.padEnd(16) + 'CREATED'.padEnd(20) + 'SIZE\n';
        imgs.forEach((img) => {
          out += `${img.repository.padEnd(20)}${img.tag.padEnd(16)}${img.id.padEnd(16)}${img.created.padEnd(20)}${img.size}\n`;
        });
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'ps') {
        const showAll = ctx.args.includes('-a') || ctx.args.includes('--all');
        const containers = globalDockerEngine.getContainers(showAll);
        let out = 'CONTAINER ID'.padEnd(16) + 'IMAGE'.padEnd(20) + 'COMMAND'.padEnd(24) + 'CREATED'.padEnd(16) + 'STATUS'.padEnd(22) + 'PORTS'.padEnd(24) + 'NAMES\n';
        containers.forEach((c) => {
          out += `${c.id.padEnd(16)}${c.image.padEnd(20)}${c.command.padEnd(24)}${c.created.padEnd(16)}${c.statusText.padEnd(22)}${c.ports.padEnd(24)}${c.name}\n`;
        });
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'run') {
        const imgName = ctx.args.find((a) => !a.startsWith('-') && a !== 'run') || 'ubuntu';
        const nameIdx = ctx.args.indexOf('--name');
        const customName = nameIdx !== -1 ? ctx.args[nameIdx + 1] : undefined;
        const portIdx = ctx.args.indexOf('-p');
        const customPort = portIdx !== -1 ? ctx.args[portIdx + 1] : undefined;

        const isInteractive = ctx.args.includes('-it') || ctx.args.includes('-t');
        const container = globalDockerEngine.runContainer(imgName, customName, customPort);

        if (isInteractive) {
          return {
            stdout: `Unable to find image '${imgName}:latest' locally...\nlatest: Pulling from library/${imgName}\nDigest: sha256:72465b0... Status: Downloaded newer image for ${imgName}:latest\nroot@${container.id.substring(0, 12)}:/# \x1b[32m[Attached to Docker container ${container.name}]\x1b[0m\n`,
            stderr: '',
            exitCode: 0,
          };
        }

        return { stdout: `${container.id}\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'stop') {
        const target = ctx.args[1];
        if (!target) return { stdout: '', stderr: 'docker stop: missing container name/ID\n', exitCode: 1 };
        const ok = globalDockerEngine.stopContainer(target);
        if (!ok) return { stdout: '', stderr: `Error response from daemon: No such container: ${target}\n`, exitCode: 1 };
        return { stdout: `${target}\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'rm') {
        const target = ctx.args[1];
        if (!target) return { stdout: '', stderr: 'docker rm: missing container name/ID\n', exitCode: 1 };
        const ok = globalDockerEngine.removeContainer(target);
        if (!ok) return { stdout: '', stderr: `Error response from daemon: No such container: ${target}\n`, exitCode: 1 };
        return { stdout: `${target}\n`, stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `docker: '${sub}' is not a docker command. See 'docker --help'\n`, exitCode: 1 };
    },
  },
];
