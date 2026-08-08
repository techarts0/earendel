// Earendel Virtual Docker Container Engine
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
    this.containers.set('c1a2b3c4d5e6', {
      id: 'c1a2b3c4d5e6',
      image: 'nginx:alpine',
      name: 'web-server',
      command: '"/docker-entrypoint.…"',
      created: '2 hours ago',
      status: 'Up',
      statusText: 'Up 2 hours',
      ports: '0.0.0.0:8080->80/tcp',
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
    const containerName = name || `suspicious_${Math.floor(Math.random() * 899 + 100)}`;
    const fullImage = imageName.includes(':') ? imageName : `${imageName}:latest`;

    const container: DockerContainer = {
      id: hexId,
      image: fullImage,
      name: containerName,
      command: cmd ? `"${cmd}"` : '"/bin/sh"',
      created: 'Just now',
      status: 'Up',
      statusText: 'Up About a minute',
      ports: ports ? `0.0.0.0:${ports}->80/tcp` : '',
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
    return this.containers.delete(c.id);
  }
}

export const globalDockerEngine = new DockerEngine();
