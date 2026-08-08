// Earendel systemd Service Manager Engine
export interface ServiceInfo {
  name: string;
  description: string;
  port?: number;
  pid: number;
  active: boolean;
  enabled: boolean;
  startTime: string;
}

class ServiceManager {
  private services: Map<string, ServiceInfo> = new Map();

  constructor() {
    this.initDefaultServices();
  }

  private initDefaultServices() {
    this.services.set('nginx', {
      name: 'nginx.service',
      description: 'A high performance web server and a reverse proxy server',
      port: 80,
      pid: 1042,
      active: true,
      enabled: true,
      startTime: new Date().toUTCString(),
    });

    this.services.set('sshd', {
      name: 'sshd.service',
      description: 'OpenSSH server daemon',
      port: 22,
      pid: 915,
      active: true,
      enabled: true,
      startTime: new Date().toUTCString(),
    });

    this.services.set('mysql', {
      name: 'mysql.service',
      description: 'MySQL Community Server',
      port: 3306,
      pid: 1208,
      active: true,
      enabled: true,
      startTime: new Date().toUTCString(),
    });

    this.services.set('cron', {
      name: 'cron.service',
      description: 'Regular background program processing daemon',
      pid: 620,
      active: true,
      enabled: true,
      startTime: new Date().toUTCString(),
    });
  }

  public getService(name: string): ServiceInfo | undefined {
    const cleanName = name.replace('.service', '');
    return this.services.get(cleanName);
  }

  public getAllServices(): ServiceInfo[] {
    return Array.from(this.services.values());
  }

  public startService(name: string): boolean {
    const s = this.getService(name);
    if (!s) return false;
    s.active = true;
    s.startTime = new Date().toUTCString();
    return true;
  }

  public stopService(name: string): boolean {
    const s = this.getService(name);
    if (!s) return false;
    s.active = false;
    return true;
  }

  public restartService(name: string): boolean {
    this.stopService(name);
    return this.startService(name);
  }

  public getListeningPorts(): { port: number; name: string }[] {
    const ports: { port: number; name: string }[] = [];
    this.services.forEach((s) => {
      if (s.active && s.port) {
        ports.push({ port: s.port, name: s.name });
      }
    });
    return ports;
  }
}

export const globalServiceManager = new ServiceManager();
