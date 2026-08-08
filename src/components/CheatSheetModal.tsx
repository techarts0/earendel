import React, { useEffect } from 'react';
import { globalVFS } from '../core/vfs';
import { globalShellEngine } from '../core/shellEngine';
import { globalFirewallEngine } from '../core/firewallEngine';
import { globalServiceManager } from '../core/serviceManager';
import { globalProcessManager } from '../core/processManager';
import { Terminal, X, Shield, Activity, HardDrive, BookOpen } from 'lucide-react';

interface CheatSheetModalProps {
  onClose: () => void;
}

export const CheatSheetModal: React.FC<CheatSheetModalProps> = ({ onClose }) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const user = globalShellEngine.getEnv('USER') || 'hello';
  const pwd = globalVFS.getPwd();
  const fwEnabled = globalFirewallEngine.isEnabled();
  const fwRulesCount = globalFirewallEngine.getRules().length;
  const activePorts = globalServiceManager.getListeningPorts();
  const jobsCount = globalProcessManager.getJobs().length;
  const procCount = globalProcessManager.getProcesses().length;

  const cheatCategories = [
    {
      category: '📁 文件与目录',
      commands: [
        { cmd: 'ls -la', desc: '列出全部文件及权限与隐藏节点' },
        { cmd: 'cd /home/hello', desc: '切换至指定家目录' },
        { cmd: 'pwd', desc: '显示当前所在绝对路径' },
        { cmd: 'chmod +x demo.sh', desc: '给文件赋予物理可执行权限' },
        { cmd: 'stat welcome.txt', desc: '查看节点详细 inode 与时间元数据' },
      ],
    },
    {
      category: '📝 文本处理与编辑器',
      commands: [
        { cmd: 'vi demo.sh', desc: '启动 VIM 沉浸式文本编辑器' },
        { cmd: 'cat welcome.txt', desc: '串联打印文本节点内容' },
        { cmd: 'grep -n "Linux" welcome.txt', desc: '检索文本并印出行号' },
        { cmd: 'echo "hello" > test.txt', desc: '重定向覆盖写入文本文件' },
      ],
    },
    {
      category: '🌐 网络与防火墙',
      commands: [
        { cmd: 'ip a / ifconfig', desc: '查看虚拟网卡 eth0 (192.168.1.100)' },
        { cmd: 'netstat -tuln', desc: '查看当前系统监听端口 (22, 80)' },
        { cmd: 'sudo ufw deny 80', desc: '配置防火墙规则物理拒绝 80 端口' },
        { cmd: 'sudo iptables -L -n', desc: '列出 Netfilter 防火墙 INPUT 链' },
        { cmd: 'nslookup earendel.local', desc: '从 /etc/hosts 中解析 IP' },
      ],
    },
    {
      category: '⚙️ 包管理与系统服务',
      commands: [
        { cmd: 'sudo apt update', desc: '刷新虚拟 APT 软件仓库源' },
        { cmd: 'sudo apt install neofetch', desc: '安装 neofetch 配置工具' },
        { cmd: 'systemctl status nginx', desc: '查看 nginx 守护进程运行状态' },
        { cmd: 'systemctl stop nginx', desc: '停止服务（联动关闭 80 端口）' },
        { cmd: 'sleep 60 & / jobs', desc: '后台启动任务与查看后台作业表' },
      ],
    },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(2, 6, 23, 0.85)',
        backdropFilter: 'blur(8px)',
        userSelect: 'none',
        fontFamily: "'Fira Code', 'Courier New', monospace",
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '1000px',
          height: '86vh',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
          overflow: 'hidden',
          color: '#f8fafc',
        }}
      >
        {/* Top Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            backgroundColor: '#020617',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontWeight: 'bold', fontSize: '14px' }}>
            <Terminal size={18} />
            <span>Earendel Telemetry & Linux Cheat Sheet (Press ESC to exit)</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '4px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Telemetry Dashboard Banner */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '12px',
            padding: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <div style={{ backgroundColor: '#020617', padding: '10px 14px', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#818cf8', fontSize: '12px', marginBottom: '4px' }}>
              <Activity size={14} />
              <span>Session & User</span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#f8fafc' }}>{user}@earendel</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>PWD: {pwd}</div>
          </div>

          <div style={{ backgroundColor: '#020617', padding: '10px 14px', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399', fontSize: '12px', marginBottom: '4px' }}>
              <HardDrive size={14} />
              <span>VFS & Processes</span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#f8fafc' }}>{procCount} Procs / {jobsCount} Jobs</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>IndexedDB Storage: Online</div>
          </div>

          <div style={{ backgroundColor: '#020617', padding: '10px 14px', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f43f5e', fontSize: '12px', marginBottom: '4px' }}>
              <Shield size={14} />
              <span>Netfilter Firewall</span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: fwEnabled ? '#34d399' : '#f43f5e' }}>
              {fwEnabled ? 'ACTIVE' : 'DISABLED'} ({fwRulesCount} Rules)
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>iptables / ufw engine</div>
          </div>

          <div style={{ backgroundColor: '#020617', padding: '10px 14px', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fbbf24', fontSize: '12px', marginBottom: '4px' }}>
              <BookOpen size={14} />
              <span>Listening Ports</span>
            </div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fbbf24' }}>
              {activePorts.map((p) => p.port).join(', ') || 'None'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>netstat -tuln synced</div>
          </div>
        </div>

        {/* Cheat Sheet Main Content */}
        <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {cheatCategories.map((cat, idx) => (
            <div key={idx} style={{ backgroundColor: '#020617', padding: '14px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#38bdf8', marginBottom: '10px' }}>{cat.category}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cat.commands.map((c, cIdx) => (
                  <div key={cIdx} style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ color: '#34d399', fontWeight: 600 }}>$ {c.cmd}</div>
                    <div style={{ color: '#94a3b8', fontSize: '11px' }}># {c.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
