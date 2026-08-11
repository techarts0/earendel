import { globalVFS } from './vfs';
import { globalNamespaceManager } from '../kernel/namespace';

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerContainer {
  id: string;
  image: string;
  name: string;
  command: string;
  created: string;
  status: 'Up' | 'Exited';
  statusText: string;
  ports: string;
  nsId: string;
  mergedPath: string;
}

class DockerEngine {
  private images: Map<string, DockerImage> = new Map();
  private containers: Map<string, DockerContainer> = new Map();

  constructor() {
    this.initDefaultImages();
    this.initDefaultContainers();
  }

  private initDefaultImages() {
    const defaultImgs: DockerImage[] = [
      { id: 'a1b2c3d4e5f6', repository: 'ubuntu', tag: 'latest', size: '77.8MB', created: '2 weeks ago' },
      { id: 'f6e5d4c3b2a1', repository: 'alpine', tag: 'latest', size: '5.54MB', created: '3 weeks ago' },
      { id: '1a2b3c4d5e6f', repository: 'nginx', tag: 'alpine', size: '23.5MB', created: '1 month ago' },
      { id: '6f5e4d3c2b1a', repository: 'python', tag: '3.10-slim', size: '125MB', created: '2 months ago' },
    ];
    defaultImgs.forEach((img) => this.images.set(img.repository, img));
  }

  private initDefaultContainers() {
    const defaultId = 'c1a2b3c4d5e6';
    const mergedPath = `/var/lib/docker/overlay2/${defaultId}/merged`;
    globalVFS.mkdir(mergedPath, true);
    globalVFS.writeFile(`${mergedPath}/etc/hostname`, 'web-server\n');

    const ns = globalNamespaceManager.createNamespace(`ns_container_${defaultId}`, {
      utsHostname: 'web-server',
      chrootPath: mergedPath,
    });

    this.containers.set(defaultId, {
      id: defaultId,
      image: 'nginx:alpine',
      name: 'web-server',
      command: '"/docker-entrypoint.sh"',
      created: '2 hours ago',
      status: 'Up',
      statusText: 'Up 2 hours',
      ports: '0.0.0.0:8080->80/tcp',
      nsId: ns.nsId,
      mergedPath,
    });
  }

  public getImages(): DockerImage[] {
    return Array.from(this.images.values());
  }

  public getContainers(all: boolean = false): DockerContainer[] {
    const list = Array.from(this.containers.values());
    if (all) return list;
    return list.filter((c) => c.status === 'Up');
  }

  public getContainer(idOrName: string): DockerContainer | undefined {
    return (
      this.containers.get(idOrName) ||
      Array.from(this.containers.values()).find((c) => c.id.startsWith(idOrName) || c.name === idOrName)
    );
  }

  public runContainer(imageName: string, name?: string, ports?: string, cmd?: string): DockerContainer {
    const hexId = Math.random().toString(16).substring(2, 14);
    const containerName = name || `container_${Math.floor(Math.random() * 899 + 100)}`;
    const fullImage = imageName.includes(':') ? imageName : `${imageName}:latest`;
    const mergedPath = `/var/lib/docker/overlay2/${hexId}/merged`;

    // 1. Create physical container root in Overlay2 VFS
    globalVFS.mkdir(mergedPath, true);
    globalVFS.mkdir(`${mergedPath}/etc`, true);
    globalVFS.mkdir(`${mergedPath}/bin`, true);
    globalVFS.mkdir(`${mergedPath}/root`, true);
    globalVFS.mkdir(`${mergedPath}/tmp`, true);

    globalVFS.writeFile(`${mergedPath}/etc/hostname`, `${containerName}\n`);
    globalVFS.writeFile(`${mergedPath}/etc/os-release`, `NAME="${imageName}"\nVERSION="22.04"\nID=${imageName}\nPRETTY_NAME="Container (${fullImage})"\n`);

    // 2. Create isolated ProcessNamespace
    const ns = globalNamespaceManager.createNamespace(`ns_container_${hexId}`, {
      utsHostname: containerName,
      chrootPath: mergedPath,
      cwd: '/root',
      env: { USER: 'root', HOME: '/root', PATH: '/bin:/usr/bin', HOSTNAME: containerName },
    });

    const container: DockerContainer = {
      id: hexId,
      image: fullImage,
      name: containerName,
      command: cmd ? `"${cmd}"` : '"/bin/sh"',
      created: 'Just now',
      status: 'Up',
      statusText: 'Up About a minute',
      ports: ports ? `0.0.0.0:${ports}->80/tcp` : '',
      nsId: ns.nsId,
      mergedPath,
    };

    this.containers.set(hexId, container);
    return container;
  }

  public stopContainer(idOrName: string): boolean {
    const c = this.getContainer(idOrName);
    if (!c) return false;
    c.status = 'Exited';
    c.statusText = 'Exited (0) Just now';
    return true;
  }

  public removeContainer(idOrName: string): boolean {
    const c = this.getContainer(idOrName);
    if (!c) return false;
    globalVFS.remove(c.mergedPath, true);
    return this.containers.delete(c.id);
  }
}

export const globalDockerEngine = new DockerEngine();
