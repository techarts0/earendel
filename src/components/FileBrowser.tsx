import React, { useEffect, useState } from 'react';
import { globalVFS, VFSNode } from '../core/vfs';
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  Shield,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

interface FileBrowserProps {
  onOpenFile?: (path: string, content: string) => void;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({ onOpenFile }) => {
  const [, setTick] = useState(0);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/', '/home', '/home/student']));
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'dir'>('file');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const unsubscribe = globalVFS.subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleCreateItem = () => {
    if (!newItemName.trim()) return;
    if (newItemType === 'dir') {
      globalVFS.mkdir(newItemName);
    } else {
      globalVFS.writeFile(newItemName, '#!/bin/bash\n# 新建文件\n');
    }
    setNewItemName('');
    setIsCreating(false);
  };

  const renderNode = (node: VFSNode, currentPath: string): React.ReactNode => {
    const isDir = node.type === 'directory';
    const isExpanded = expandedPaths.has(currentPath);
    const isCurrentPwd = globalVFS.getPwd() === currentPath;

    const getIcon = () => {
      if (isDir) {
        return isExpanded ? (
          <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-amber-400 shrink-0" />
        );
      }
      if (node.name.endsWith('.sh')) {
        return <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />;
      }
      return <FileText className="w-4 h-4 text-sky-400 shrink-0" />;
    };

    return (
      <div key={node.id} className="text-xs select-none">
        {/* Row Element */}
        <div
          className={`flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-all group ${
            isCurrentPwd
              ? 'bg-sky-500/15 text-sky-300 font-medium border border-sky-500/20'
              : 'hover:bg-slate-800/60 text-slate-300'
          }`}
          onClick={() => {
            if (isDir) {
              toggleExpand(currentPath);
            } else if (onOpenFile) {
              onOpenFile(currentPath, node.content ?? '');
            }
          }}
        >
          <div className="flex items-center gap-2 overflow-hidden truncate">
            {isDir ? (
              <span className="text-slate-500 hover:text-slate-300">
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            ) : (
              <span className="w-3.5 h-3.5" />
            )}
            {getIcon()}
            <span className="truncate font-mono">{node.name || '/'}</span>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
            <span className="hidden group-hover:inline-flex items-center gap-1 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
              <Shield className="w-2.5 h-2.5 text-indigo-400" />
              {node.permissions}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (currentPath !== '/') {
                  globalVFS.remove(currentPath, true);
                }
              }}
              className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 p-0.5 transition-all"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Children Render */}
        {isDir && isExpanded && node.children && (
          <div className="ml-3.5 pl-2 border-l border-slate-800/80 flex flex-col gap-0.5 mt-0.5">
            {Array.from(node.children.values()).map((child) => {
              const childPath = currentPath === '/' ? `/${child.name}` : `${currentPath}/${child.name}`;
              return renderNode(child, childPath);
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col glass-panel overflow-hidden border border-slate-800">
      {/* Header Bar */}
      <div className="h-9 px-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-slate-300 flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-sky-400" />
          可视化虚拟目录树
        </span>
        <button
          onClick={() => setIsCreating(!isCreating)}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-sky-400 transition-all"
          title="新建文件或文件夹"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Add Form */}
      {isCreating && (
        <div className="p-2 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
          <select
            value={newItemType}
            onChange={(e) => setNewItemType(e.target.value as 'file' | 'dir')}
            className="bg-slate-950 text-xs text-slate-300 px-2 py-1 rounded border border-slate-800"
          >
            <option value="file">文件</option>
            <option value="dir">目录</option>
          </select>
          <input
            type="text"
            placeholder="如: test.sh"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateItem()}
            className="flex-1 bg-slate-950 text-xs text-slate-200 px-2 py-1 rounded border border-slate-800 focus:outline-none focus:border-sky-500 font-mono"
          />
          <button
            onClick={handleCreateItem}
            className="px-2.5 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded font-medium shadow"
          >
            创建
          </button>
        </div>
      )}

      {/* Tree Content */}
      <div className="flex-1 p-2 overflow-y-auto">
        {renderNode(globalVFS.root, '/')}
      </div>
    </div>
  );
};
