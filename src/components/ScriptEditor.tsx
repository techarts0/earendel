import React, { useState } from 'react';
import { Play, Save, Code2, Sparkles, FilePlus } from 'lucide-react';
import { globalVFS } from '../core/vfs';

interface ScriptEditorProps {
  onRunScript: (scriptCmd: string) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ onRunScript }) => {
  const [fileName, setFileName] = useState('my_script.sh');
  const [code, setCode] = useState<string>(`#!/bin/bash
# Earendel 在线 Shell 脚本编辑器示例

NAME="Linux 探索者"
echo "欢迎来到 Earendel Shell 编程实验室！"
echo "今天日期是: $(date)"

# 简单循环示范
for i in 1 2 3 4 5
do
  echo "正在打印第 $i 个测试数据..."
done
`);

  const handleSave = () => {
    globalVFS.writeFile(fileName, code);
  };

  const handleRun = () => {
    handleSave();
    onRunScript(`bash ${fileName}`);
  };

  return (
    <div className="w-full h-full flex flex-col glass-panel overflow-hidden border border-slate-800">
      {/* Top Action Bar */}
      <div className="h-10 px-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-purple-400" />
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-purple-300 font-mono px-2 py-1 rounded focus:outline-none focus:border-purple-500 w-40"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-all"
          >
            <Save className="w-3.5 h-3.5" />
            保存文件
          </button>

          <button
            onClick={handleRun}
            className="flex items-center gap-1.5 px-3.5 py-1 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium shadow-md shadow-emerald-500/20 transition-all"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            保存并运行脚本
          </button>
        </div>
      </div>

      {/* Editor Main Content Area */}
      <div className="flex-1 relative flex bg-[#0c101c]">
        {/* Line Numbers */}
        <div className="w-10 bg-slate-950/50 py-3 text-right pr-2 text-xs font-mono text-slate-600 select-none border-r border-slate-900">
          {code.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea Code Input */}
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="# 在此输入 Bash / Shell 脚本..."
          className="flex-1 p-3 bg-transparent text-slate-100 font-mono text-xs leading-relaxed focus:outline-none resize-none selection:bg-purple-500/30"
          spellCheck={false}
        />
      </div>

      {/* Footer Info */}
      <div className="h-7 px-3 bg-slate-950 border-t border-slate-900 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-purple-400" /> 支持变量赋值、for/while 循环、if 分支与管道符
        </span>
        <span>Shell (Bash)</span>
      </div>
    </div>
  );
};
